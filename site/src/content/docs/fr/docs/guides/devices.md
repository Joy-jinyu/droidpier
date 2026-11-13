---
title: Appareils
description: Listez vos appareils virtuels Android, démarrez-les et arrêtez-les depuis la page, et prenez la main sur un émulateur déjà en cours d’exécution.
sourceHash: 160631b5e5d9
---

Ici, un appareil est un Android Virtual Device (AVD) sur votre Mac. La page affiche un appareil à la fois.

## La liste des appareils

<!-- verify: phase 2 -->
La liste à gauche affiche chaque AVD signalé par `emulator -list-avds`. Pour chacun, elle affiche :

- le nom ;
- la résolution de l’écran ;
- la version d’Android ;
- l’état : arrêté, en démarrage (avec les secondes écoulées), en cours d’exécution, ou en cours d’exécution mais impossible à prendre en main ;
- un bouton de démarrage ou d’arrêt.

<!-- verify: phase 2 -->
La résolution, la RAM et la version d’Android proviennent du `config.ini` de chaque AVD dans `~/.android/avd/<name>.avd/`. Si vous définissez `ANDROID_AVD_HOME`, la passerelle lit ce répertoire à la place. Si un champ manque dans `config.ini`, il reste vide.

## Démarrer un appareil

<!-- verify: phase 2 -->
Cliquez sur démarrer à côté d’un appareil. La passerelle exécute :

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` signifie qu’aucune fenêtre d’émulateur séparée ne s’ouvre. L’écran n’apparaît que dans la page.
- Le port gRPC est le premier port pair libre à partir de `8554`.
- L’appareil est considéré comme démarré lorsque `adb -s emulator-<serial> shell getprop sys.boot_completed` renvoie `1`. La page affiche la progression jusque-là.
- Si l’appareil n’a pas démarré au bout de 180 secondes, le démarrage échoue et la passerelle met fin au processus de l’émulateur.

<!-- verify: phase 2 -->
Cliquer à nouveau sur démarrer pendant qu’un appareil démarre ne lance pas une deuxième instance. Si vous fermez la page pendant le démarrage puis la rouvrez, la progression continue.

## Arrêter un appareil

<!-- verify: phase 2 -->
Cliquez sur arrêter. La passerelle exécute `adb -s emulator-<serial> emu kill`.

## Émulateurs déjà en cours d’exécution

La passerelle trouve les émulateurs en cours d’exécution grâce aux fichiers que l’émulateur écrit dans `~/Library/Caches/TemporaryItems/avd/running/`. Si un émulateur tourne avec gRPC activé, par exemple un émulateur que vous avez lancé avec `-grpc <port>`, la passerelle s’y connecte au lieu d’en démarrer une autre instance.

<!-- verify: phase 2 -->
Un émulateur qui tourne sans gRPC est marqué « en cours d’exécution mais impossible à prendre en main ». La passerelle a besoin de gRPC pour lire l’écran et envoyer les saisies. Arrêtez cet émulateur et démarrez-le depuis la page.

## Quand la passerelle s’arrête

Arrêter la passerelle n’arrête pas les émulateurs. Quand vous redémarrez la passerelle, elle s’y reconnecte.

## Créer un appareil

<!-- verify: phase 3 -->
Créez les appareils sur la page. Utilisez le bouton pour un nouvel appareil, choisissez un modèle d’appareil et une version d’Android, puis donnez un nom à l’appareil ; la page en propose un. Avant toute action, la page affiche le modèle, la version d’Android et la mémoire de l’appareil. Si l’image système de cette version n’est pas encore installée, la passerelle la télécharge après que vous avez confirmé et accepté la licence de Google.

Créer un appareil ne demande ni Android Studio ni les outils en ligne de commande : la passerelle écrit elle-même les fichiers de l’appareil, au format qu’utilise Android Studio. Voir [Premier lancement](/fr/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

Vous pouvez aussi créer des appareils dans le Device Manager d’Android Studio ; la liste les détecte.

## Supprimer un appareil

Cliquez sur l'icône de corbeille à côté d'un appareil et confirmez. L'appareil et toutes ses données (applications installées, fichiers, instantanés) sont supprimés ; c'est irréversible. L'image système reste installée. Un appareil en cours d'exécution ou de démarrage ne peut pas être supprimé : arrêtez-le d'abord.
