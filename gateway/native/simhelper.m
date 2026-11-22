// iOS 模拟器的画面和触摸：网关为每台连上的模拟器起一个这个进程（gateway/src/ios-sim.ts），不开 Simulator.app。
// 画面：CoreSimulator 的帧缓冲每画一帧回调一次，交给 VideoToolbox 硬件编码成 H.264（Annex B）；画面不动时不编码。
// 输入：SimulatorKit 的 IndigoHIDMessageForMouseNSEvent 构造触摸消息。两者都是 Xcode 里的私有框架，
// 只在 Xcode 27.1 上验证过（2026-11-21 实测），Xcode 升级后可能要跟着改。
//
// 用法：simhelper <Xcode Developer 目录> <模拟器 UDID>
// stdout：一帧一个包，[u32 小端 长度][u8 类型][内容]，长度不含自己的 4 字节。
//   类型 1 视频：[u8 标志：第 0 位配置包、第 1 位关键帧][u32 宽][u32 高][Annex B 数据]
//   类型 2 事件：UTF-8 JSON，{"t":"ready","width":..,"height":..} 或 {"t":"error","message":..}
// stdin：一行一个 JSON 命令。{"t":"touch","x":..,"y":..,"down":true|false,"edge":0..4}（帧缓冲像素；edge 是从哪条屏幕边缘
//   开始的系统手势，3 是底边：全面屏的回主屏、多任务要带上它，系统才认，2026-11-22 iOS 18.3 实测）、{"t":"keyframe"}、
//   {"t":"button","source":..,"down":..}（硬件按键，source 见 gateway/src/ios-keys.ts）、{"t":"hidkey","usage":..,"down":..}（键盘，USB HID 键码）
// stdin 关闭即退出。
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <IOSurface/IOSurface.h>
#import <VideoToolbox/VideoToolbox.h>
#import <objc/runtime.h>
#import <objc/message.h>
#include <dlfcn.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>

#define CALL(o, s) ((id(*)(id, SEL))objc_msgSend)(o, sel_registerName(s))

// 参数按 Xcode 27.1 反汇编确认：两个触点、HID 目标、NSEventType、边缘、屏幕尺寸（触点用 0..1 的比例时传 1,1）
typedef void *(*MouseFn)(CGPoint *, CGPoint *, uint32_t, uint64_t, uint64_t, double, double);
// 按 Xcode 27.1 反汇编确认：按键来源、方向（1 按下、2 抬起）、目标；键盘是 HID 键码、方向
typedef void *(*ButtonFn)(uint32_t, uint32_t, uint32_t);
typedef void *(*KeyboardFn)(uint32_t, uint32_t);
// 硬件按键的 HID 目标（idb 的 FBSimulatorIndigoHID 用的同一个值）
static const uint32_t TARGET_HARDWARE = 0x33;
// 触摸屏的 HID 目标（idb 的 FBSimulatorIndigoHID 用的同一个值）
static const uint32_t TARGET_DIGITIZER = 0x32;
enum { EV_DOWN = 1, EV_UP = 2, EV_DRAG = 6 };

static dispatch_queue_t outQ;
// 都放全局：ARC 会在局部变量最后一次使用后就释放，进 dispatch_main 前 device 就没了，SimulatorKit 的 HID 监视队列随后访问它崩掉
static id device, screenPort, hidClient;
static MouseFn mouseMessage;
static ButtonFn buttonMessage;
static KeyboardFn keyboardMessage;
static size_t fbWidth, fbHeight;
static VTCompressionSessionRef encoder;
static BOOL forceKey = YES, touching = NO;
static NSData *lastConfig;

static void writeAll(const void *p, size_t n) {
  const uint8_t *b = p;
  while (n) {
    ssize_t w = write(STDOUT_FILENO, b, n);
    if (w < 0 && errno == EINTR) continue;
    // 网关关掉管道（EPIPE）就退出
    if (w <= 0) exit(0);
    b += w; n -= (size_t)w;
  }
}

static void emit(uint8_t type, NSData *body) {
  dispatch_async(outQ, ^{
    uint32_t len = (uint32_t)body.length + 1;
    writeAll(&len, 4);
    writeAll(&type, 1);
    writeAll(body.bytes, body.length);
  });
}

static void event(NSDictionary *d) { emit(2, [NSJSONSerialization dataWithJSONObject:d options:0 error:nil]); }

static void fail(NSString *msg) {
  event(@{@"t": @"error", @"message": msg});
  dispatch_sync(outQ, ^{});
  exit(1);
}

static void video(BOOL config, BOOL key, NSData *data) {
  NSMutableData *b = [NSMutableData dataWithCapacity:data.length + 9];
  uint8_t flags = (config ? 1 : 0) | (key ? 2 : 0);
  uint32_t w = (uint32_t)fbWidth, h = (uint32_t)fbHeight;
  [b appendBytes:&flags length:1];
  [b appendBytes:&w length:4];
  [b appendBytes:&h length:4];
  [b appendData:data];
  emit(1, b);
}

static const uint8_t START[4] = {0, 0, 0, 1};

// SPS/PPS 从格式描述里取，拼成 Annex B；格式没变就不重发
static void sendConfig(CMFormatDescriptionRef fmt) {
  size_t count = 0;
  CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, 0, NULL, NULL, &count, NULL);
  NSMutableData *cfg = [NSMutableData data];
  for (size_t i = 0; i < count; i++) {
    const uint8_t *p; size_t n;
    if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, i, &p, &n, NULL, NULL) != noErr) return;
    [cfg appendBytes:START length:4];
    [cfg appendBytes:p length:n];
  }
  if ([cfg isEqualToData:lastConfig]) return;
  lastConfig = cfg;
  video(YES, NO, cfg);
}

static void onEncoded(OSStatus st, CMSampleBufferRef sb) {
  if (st != noErr || !sb || !CMSampleBufferDataIsReady(sb)) return;
  CFArrayRef att = CMSampleBufferGetSampleAttachmentsArray(sb, false);
  BOOL key = !(att && CFArrayGetCount(att) && CFDictionaryContainsKey(CFArrayGetValueAtIndex(att, 0), kCMSampleAttachmentKey_NotSync));
  if (key) sendConfig(CMSampleBufferGetFormatDescription(sb));
  // VideoToolbox 出的是 4 字节长度前缀（AVCC），页面的 WebCodecs 按 Annex B 解码：把长度换成起始码
  CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(sb);
  size_t total = CMBlockBufferGetDataLength(bb);
  NSMutableData *out = [NSMutableData dataWithLength:total];
  if (CMBlockBufferCopyDataBytes(bb, 0, total, out.mutableBytes) != noErr) return;
  uint8_t *p = out.mutableBytes;
  for (size_t off = 0; off + 4 <= total;) {
    uint32_t n = CFSwapInt32BigToHost(*(uint32_t *)(p + off));
    memcpy(p + off, START, 4);
    off += 4 + n;
  }
  video(NO, key, out);
}

static void createEncoder(void) {
  NSDictionary *spec = @{(id)kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: @YES};
  OSStatus st = VTCompressionSessionCreate(NULL, (int32_t)fbWidth, (int32_t)fbHeight, kCMVideoCodecType_H264,
                                           (__bridge CFDictionaryRef)spec, NULL, NULL, NULL, NULL, &encoder);
  if (st != noErr) fail([NSString stringWithFormat:@"创建 H.264 编码器失败（%d）", (int)st]);
  VTSessionSetProperty(encoder, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
  VTSessionSetProperty(encoder, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
  VTSessionSetProperty(encoder, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel);
  // 码率：验证时 1398x2034 持续滑动平均 4.8 Mbit/s，上限给到 12
  VTSessionSetProperty(encoder, kVTCompressionPropertyKey_AverageBitRate, (__bridge CFTypeRef)@(12000000));
  // 画面不动时没有帧，不会自己出关键帧；新页面要看画面时由网关发 keyframe 命令
  VTSessionSetProperty(encoder, kVTCompressionPropertyKey_MaxKeyFrameInterval, (__bridge CFTypeRef)@(INT32_MAX));
}

// 帧回调和 keyframe 命令都在 encodeQ 上跑，encoder / forceKey 只在这里改；fbWidth / fbHeight 也在这里写，inputQ 只读
static dispatch_queue_t encodeQ;
static int64_t pts;

static void encodeCurrent(void);
// 画面停下 100 ms 后把同一帧再编一遍、编成关键帧：浏览器的硬件解码器总压着最近的帧，收到下一帧才吐出来，
// 画面静止时最后一帧、切过来时的关键帧就一直显示不出来。重复成 P 帧不行：2026-11-21 Chrome 实测关键帧后跟几个
// P 帧都一帧不出，再来一个关键帧（IDR 会让解码器把压着的帧全吐出来）才出。代价是每次停下多一个关键帧（约 30 KB）。
// scrcpy 那边靠 Android 编码器「100 ms 没新帧就重复上一帧」，是同一个问题
static const int64_t REPEAT_AFTER_NS = 100 * NSEC_PER_MSEC;
static uint64_t frameGen;

static void encodeFresh(void) {
  encodeCurrent();
  uint64_t gen = ++frameGen;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, REPEAT_AFTER_NS), encodeQ, ^{
    if (gen != frameGen) return;
    forceKey = YES;
    encodeCurrent();
  });
}

static void encodeCurrent(void) {
  IOSurfaceRef s = (__bridge IOSurfaceRef)CALL(screenPort, "framebufferSurface");
  if (!s) return;
  if (IOSurfaceGetWidth(s) != fbWidth || IOSurfaceGetHeight(s) != fbHeight) {
    fbWidth = IOSurfaceGetWidth(s);
    fbHeight = IOSurfaceGetHeight(s);
    if (encoder) { VTCompressionSessionInvalidate(encoder); CFRelease(encoder); encoder = NULL; }
    lastConfig = nil;
    forceKey = YES;
    event(@{@"t": @"ready", @"width": @(fbWidth), @"height": @(fbHeight)});
  }
  if (!encoder) createEncoder();
  CVPixelBufferRef pb = NULL;
  if (CVPixelBufferCreateWithIOSurface(NULL, s, NULL, &pb) != kCVReturnSuccess) return;
  NSDictionary *opts = forceKey ? @{(id)kVTEncodeFrameOptionKey_ForceKeyFrame: @YES} : nil;
  forceKey = NO;
  VTCompressionSessionEncodeFrameWithOutputHandler(encoder, pb, CMTimeMake(pts++, 60), kCMTimeInvalid,
                                                   (__bridge CFDictionaryRef)opts, NULL,
                                                   ^(OSStatus st, VTEncodeInfoFlags f, CMSampleBufferRef sb) { onEncoded(st, sb); });
  CVPixelBufferRelease(pb);
  // 编码器会压着最后一帧等下一帧才吐出来；画面停下时最后一帧就一直出不来，所以每帧都催一次（硬件编码 1398x2034 约 9 ms）
  VTCompressionSessionCompleteFrames(encoder, kCMTimeInvalid);
}

// 触摸都在 inputQ 上一条条发：上一条没发完就发下一条，SimulatorKit 会在自己的 HID 队列里崩（2026-11-21 实测 16 ms 一条必崩）
static dispatch_queue_t inputQ;

static void hidSend(void *msg) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  ((void (*)(id, SEL, void *, BOOL, id, id))objc_msgSend)(hidClient, sel_registerName("sendWithMessage:freeWhenDone:completionQueue:completion:"),
                                                          msg, YES, dispatch_get_global_queue(0, 0), ^(NSError *e) {
    if (e) event(@{@"t": @"error", @"message": [NSString stringWithFormat:@"触摸没发出去：%@", e.localizedDescription]});
    dispatch_semaphore_signal(done);
  });
  dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC));
}

static void touch(double x, double y, BOOL down, uint64_t edge) {
  if (!fbWidth || !fbHeight) return;
  uint64_t type = !down ? EV_UP : touching ? EV_DRAG : EV_DOWN;
  if (!down && !touching) return;
  touching = down;
  CGPoint p = {fmin(fmax(x / fbWidth, 0), 1), fmin(fmax(y / fbHeight, 0), 1)};
  // 偶尔返回空（一次滑动里约一条，原因不明，2026-11-21 实测）；空消息发出去 SimulatorKit 直接崩。重试一次，还是空就丢掉这一个采样点
  void *msg = mouseMessage(&p, NULL, TARGET_DIGITIZER, type, edge, 1.0, 1.0);
  if (!msg) msg = mouseMessage(&p, NULL, TARGET_DIGITIZER, type, edge, 1.0, 1.0);
  if (msg) hidSend(msg);
}

static void button(uint32_t source, BOOL down) {
  void *msg = buttonMessage(source, down ? 1 : 2, TARGET_HARDWARE);
  if (msg) hidSend(msg);
}

static void hidKey(uint32_t usage, BOOL down) {
  void *msg = keyboardMessage(usage, down ? 1 : 2);
  if (msg) hidSend(msg);
}

static id findDevice(NSString *developerDir, NSString *udid) {
  NSError *e = nil;
  id ctx = ((id (*)(id, SEL, id, NSError **))objc_msgSend)(objc_getClass("SimServiceContext"), sel_registerName("sharedServiceContextForDeveloperDir:error:"), developerDir, &e);
  if (!ctx) fail([NSString stringWithFormat:@"连不上 CoreSimulator：%@", e.localizedDescription]);
  id set = ((id (*)(id, SEL, NSError **))objc_msgSend)(ctx, sel_registerName("defaultDeviceSetWithError:"), &e);
  for (id d in CALL(set, "devices"))
    if ([[CALL(d, "UDID") UUIDString] isEqualToString:udid]) return d;
  return nil;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    // Node 给子进程的 stdio 是非阻塞的：管道写满时 write 返回 EAGAIN，会被当成网关走了而退出。改回阻塞
    for (int fd = 0; fd <= 1; fd++) fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) & ~O_NONBLOCK);
    signal(SIGPIPE, SIG_IGN);
    outQ = dispatch_queue_create("out", DISPATCH_QUEUE_SERIAL);
    encodeQ = dispatch_queue_create("encode", DISPATCH_QUEUE_SERIAL);
    inputQ = dispatch_queue_create("input", DISPATCH_QUEUE_SERIAL);
    if (argc < 3) fail(@"用法：simhelper <Developer 目录> <UDID>");
    NSString *dev = @(argv[1]);
    if (!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW)) fail(@"找不到 CoreSimulator（Xcode 没装好或没启动过一次）");
    NSString *sk = [[dev stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"SharedFrameworks/SimulatorKit.framework/SimulatorKit"];
    void *skh = dlopen(sk.fileSystemRepresentation, RTLD_NOW);
    if (!skh) fail([NSString stringWithFormat:@"找不到 SimulatorKit：%@", sk]);
    mouseMessage = (MouseFn)dlsym(skh, "IndigoHIDMessageForMouseNSEvent");
    buttonMessage = (ButtonFn)dlsym(skh, "IndigoHIDMessageForButton");
    keyboardMessage = (KeyboardFn)dlsym(skh, "IndigoHIDMessageForKeyboardArbitrary");
    if (!mouseMessage || !buttonMessage || !keyboardMessage) fail(@"这个版本的 Xcode 里没有要用的 IndigoHIDMessage 函数");

    device = findDevice(dev, @(argv[2]));
    if (!device) fail(@"找不到这台模拟器");
    // 一台模拟器有好几个显示端口：外接屏是 display class 1，折叠机（iPhone Duo）还有两块 class 0 的屏，
    // 只有正在用的那块有帧缓冲。取第一块有帧缓冲的 class 0；刚开机时还没有，等一会儿（2026-11-21 实测 iPhone Duo）
    for (int tries = 0; !screenPort && tries < 40; tries++) {
      for (id port in CALL(CALL(device, "io"), "ioPorts")) {
        id desc = CALL(port, "descriptor");
        if (![desc respondsToSelector:sel_registerName("framebufferSurface")] ||
            ![desc respondsToSelector:sel_registerName("registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:")]) continue;
        if (((uint16_t (*)(id, SEL))objc_msgSend)(CALL(desc, "state"), sel_registerName("displayClass")) != 0) continue;
        if (!CALL(desc, "framebufferSurface")) continue;
        screenPort = desc;
        break;
      }
      if (!screenPort) usleep(250000);
    }
    if (!screenPort) fail(@"模拟器没有屏幕（没开机？）");
    NSError *e = nil;
    // 必须给会话重置回调：initWithDevice:error: 不给，模拟器那边的 HID 会话一重置，SimulatorKit 就调空指针崩掉（2026-11-21 实测）
    hidClient = ((id (*)(id, SEL, id, id, NSError **, id))objc_msgSend)([objc_getClass("_TtC12SimulatorKit24SimDeviceLegacyHIDClient") alloc],
        sel_registerName("initWithDevice:sessionResetQueue:error:sessionResetHandler:"), device, inputQ, &e, ^{ touching = NO; });
    if (!hidClient) fail([NSString stringWithFormat:@"连不上模拟器的触摸输入：%@", e.localizedDescription]);

    void (^frame)(void) = ^{ encodeFresh(); };
    ((void (*)(id, SEL, id, id, id, id, id))objc_msgSend)(screenPort, sel_registerName("registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:"),
                                                       [NSUUID UUID], encodeQ, frame, frame, ^{});
    // 先出一帧：画面静止时帧回调不来，页面也要能看到当前画面
    dispatch_async(encodeQ, ^{ encodeFresh(); });

    // 读 stdin 会一直阻塞，放在自己的线程上，不占 GCD 的工作线程
    [NSThread detachNewThreadWithBlock:^{
      char *line = NULL; size_t cap = 0; ssize_t n;
      while ((n = getline(&line, &cap, stdin)) > 0) @autoreleasepool {
        NSDictionary *m = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:line length:(NSUInteger)n] options:0 error:nil];
        if (![m isKindOfClass:NSDictionary.class]) continue;
        NSString *t = m[@"t"];
        if ([t isEqual:@"touch"]) {
          double x = [m[@"x"] doubleValue], y = [m[@"y"] doubleValue];
          BOOL down = [m[@"down"] boolValue];
          uint64_t edge = [m[@"edge"] unsignedLongLongValue];
          dispatch_async(inputQ, ^{ touch(x, y, down, edge); });
        } else if ([t isEqual:@"button"]) {
          uint32_t source = (uint32_t)[m[@"source"] unsignedIntValue];
          BOOL down = [m[@"down"] boolValue];
          dispatch_async(inputQ, ^{ button(source, down); });
        } else if ([t isEqual:@"hidkey"]) {
          uint32_t usage = (uint32_t)[m[@"usage"] unsignedIntValue];
          BOOL down = [m[@"down"] boolValue];
          dispatch_async(inputQ, ^{ hidKey(usage, down); });
        } else if ([t isEqual:@"keyframe"]) {
          dispatch_async(encodeQ, ^{ forceKey = YES; lastConfig = nil; encodeFresh(); });
        }
      }
      dispatch_sync(outQ, ^{});
      exit(0);
    }];
    // 主线程跑 CFRunLoop，不用 dispatch_main（dispatch_main 会让主线程 pthread_exit）
    CFRunLoopRun();
  }
}
