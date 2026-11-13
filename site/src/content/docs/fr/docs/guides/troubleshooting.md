---
title: Dépannage
description: Résoudre les problèmes courants - Chrome a bloqué l’accès au réseau local, port déjà utilisé, aucun émulateur trouvé, la page ne se connecte pas, versions incompatibles.
sourceHash: d8eaddc9fa12
---

## Chrome a bloqué l’accès au réseau local {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
La page sur `droid.devpier.dev` se connecte à la passerelle sur votre propre Mac. Chrome demande l’autorisation la première fois. Si vous l’avez refusée, la page ne peut pas se connecter et, après quelques tentatives échouées, elle vous indique que Chrome a bloqué l’accès à votre Mac.

Pour l’autoriser à nouveau :

1. Ouvrez dans Chrome **Paramètres → Confidentialité et sécurité → Paramètres des sites**.
2. Trouvez `droid.devpier.dev` et autorisez l’accès au réseau local.
3. Rechargez la page.

Si vous ne parvenez toujours pas à vous connecter, utilisez la [page de secours locale](#use-the-local-fallback-page).

## Port déjà utilisé

La passerelle écoute par défaut sur le port `7300`.

Si la passerelle tourne en arrière-plan, relancer la commande la redémarre. Si une passerelle tourne dans une fenêtre Terminal, la commande n’en démarre pas une seconde : elle indique que droidpier tourne déjà sur le port `7300`. Arrêtez celle-ci avec `Ctrl+C`, puis relancez la commande.

Si un autre programme utilise le port, la passerelle le signale, propose un autre port et s’arrête. Trouvez ce programme :

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

Arrêtez ce programme, ou démarrez la passerelle sur un autre port :

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

Après l’installation, `droidpier --port 7301` fait la même chose.

<!-- verify: phase 3 -->
La passerelle met le nouveau port dans l’adresse qu’elle ouvre, donc la page se connecte au bon port.

## Aucun émulateur trouvé

Si la page indique qu’aucun émulateur en cours d’exécution n’a été trouvé :

- Vérifiez qu’un émulateur tourne : `adb devices` devrait lister `emulator-5554` ou un nom similaire.
- Vérifiez qu’il a été démarré avec gRPC activé (`-grpc <port>`). La passerelle ne peut pas lire l’écran d’un émulateur sans gRPC.

<!-- verify: phase 2 -->
Vous pouvez aussi démarrer un appareil depuis la liste dans la page. Voir [Appareils](/fr/docs/guides/devices/).

La passerelle continue de tourner quand aucun émulateur n’est trouvé et en indique la raison : dans Terminal, ou dans son journal quand elle tourne en arrière-plan (`droidpier logs`).

<!-- verify: phase 3 -->
Si la passerelle signale que `emulator`, `platform-tools`, une image système ou un appareil manque, terminez la configuration sur la page. Voir [Premier lancement](/fr/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## L’image système d’un appareil est manquante

<!-- verify: phase 3 -->
Si vous avez supprimé une image système, par exemple dans Android Studio, les appareils qui l’utilisent ne peuvent plus démarrer. La page nomme chacun de ces appareils et la version d’Android qui lui manque, et propose de réinstaller cette image. Un seul appareil capable de démarrer suffit : la page ne demande plus rien dès qu’un appareil a son image système.

## Une installation échoue

<!-- verify: phase 3 -->
La page affiche la raison sous l’élément. Si un téléchargement ne correspond pas à la somme de contrôle publiée par Google, rien n’est décompressé ; installez l’élément à nouveau. Si aucune donnée n’arrive pendant une minute, le téléchargement s’arrête ; vérifiez votre connexion réseau et réessayez. Droidpier n’a besoin ni de Java ni des outils en ligne de commande : l’absence de `sdkmanager` n’est donc pas un problème.

## La page ne se connecte pas

<!-- verify: phase 3 -->
La page vérifie une fois par seconde si la passerelle est là et se connecte dès qu’elle répond. Si elle continue d’attendre :

- Lancez `droidpier status` pour vérifier que la passerelle tourne. Sinon, lancez `droidpier start`. `droidpier logs` montre pourquoi elle s’est arrêtée.
- Vérifiez que Chrome autorise l’accès au réseau local pour `droid.devpier.dev`. Voir [Chrome a bloqué l’accès au réseau local](#chrome-blocked-local-network-access).
- Si vous avez démarré la passerelle avec `--port`, ouvrez l’adresse qu’elle a affichée, qui se termine par `#port=<port>`.
- Mettez l’onglet au premier plan. La page ne vérifie pas tant que l’onglet est en arrière-plan.

## La commande d’installation échoue

- **Échec de la somme de contrôle :** le téléchargement ne correspondait pas à sa somme de contrôle, donc rien n’a été installé. Relancez la commande.
- **Site de téléchargement injoignable :** si Droidpier est déjà installé, la commande vous avertit et démarre la copie que vous avez. S’il n’est pas encore installé, vérifiez votre connexion Internet et relancez la commande.

## La page indique que la passerelle ou la page n’est plus à jour

<!-- verify: phase 3 -->
- **Passerelle pas à jour :** exécutez la commande de mise à niveau affichée par la page. C’est la même que la [commande d’installation](/fr/docs/getting-started/install/).
- **Page pas à jour :** forcez le rechargement de la page avec Cmd+Shift+R.

## Mauvais navigateur

<!-- verify: phase 3 -->
La page ne fonctionne que dans Chrome et Edge. Dans les autres navigateurs, elle vous demande de changer de navigateur et ne tente pas de se connecter. Voir [Navigateurs pris en charge](/fr/docs/reference/browser-support/).

## Utiliser la page de secours locale {#use-the-local-fallback-page}

La passerelle sert la même page à `http://127.0.0.1:7300/app/` (ou sur le port que vous avez choisi). Utilisez-la lorsque la page publique ne se charge pas ou que l’accès au réseau local a été refusé.

Lancez `droidpier --local` pour que la passerelle ouvre la page locale plutôt que la page publique.

## L’écran ne se met plus à jour

Si l’émulateur se ferme ou redémarre, la page indique qu’elle est déconnectée. La passerelle continue de tourner. Quand l’émulateur revient, la page se reconnecte et l’écran réapparaît.

## Désinstaller {#uninstall}

Arrêtez la passerelle en arrière-plan, puis supprimez les fichiers qu’elle utilise :

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

Si `droidpier` est déjà supprimé mais que la passerelle en arrière-plan tourne encore ou démarre à l’ouverture de session, retirez-la à la main :

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
