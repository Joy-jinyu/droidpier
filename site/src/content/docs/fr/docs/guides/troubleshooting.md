---
title: Dépannage
description: Résoudre les problèmes courants - Chrome a bloqué l’accès au réseau local, port déjà utilisé, aucun émulateur trouvé, la page ne se connecte pas, versions incompatibles.
sourceHash: 0b338512d1e9
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
Si la passerelle signale que l’Android SDK, `emulator`, `platform-tools` ou l’image système sont manquants, suivez la solution qu’elle affiche. Voir [Premier lancement](/fr/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## « sdkmanager » est manquant

<!-- verify: phase 3 -->
Un SDK installé par Android Studio peut ne pas inclure `cmdline-tools`, qui fournit `sdkmanager` et `avdmanager`. La page propose de l’installer : avec le bouton d’installation à côté dans la liste des éléments manquants, ou dans la boîte de dialogue de création d’un appareil. Après votre confirmation, la passerelle télécharge les outils en ligne de commande 22.0 depuis Google dans votre SDK. La page affiche chaque licence Google en entier et n’installe que si vous l’acceptez.

`sdkmanager` a besoin de Java. Si vous n’en avez pas, installez Android Studio, qui inclut Java, ou JDK 17 ou plus récent, puis rouvrez la page.

Pour installer les outils à la main, téléchargez les outils en ligne de commande de Google depuis developer.android.com et décompressez-les de sorte que ce chemin existe :

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

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
