---
title: Premier lancement
description: Démarrez la passerelle en une commande, laissez-la vérifier l’Android SDK, autorisez l’accès au réseau local dans Chrome et voyez votre émulateur.
sourceHash: 7b613962f696
---

Exécutez une commande dans Terminal, ouvrez `https://droid.devpier.dev/app/` et autorisez l’accès au réseau local quand Chrome le demande.

## 1. Démarrer la passerelle

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Elle installe ou met à jour la passerelle si nécessaire, puis la démarre. Voir [Installation](/fr/docs/getting-started/install/). Après l’installation, `droidpier start` la démarre aussi.

La passerelle tourne en arrière-plan. Vous pouvez fermer la fenêtre Terminal.

La passerelle écoute sur `127.0.0.1`, port `7300` par défaut. Pour utiliser un autre port, voir [Ligne de commande](/fr/docs/reference/cli/).

## 2. La laisser vérifier votre Android SDK {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
Au démarrage, la passerelle vérifie la présence de l’Android SDK, de `cmdline-tools`, `emulator`, `platform-tools`, de l’image système `system-images;android-34;google_apis;arm64-v8a` et d’au moins un appareil virtuel (AVD). S’il manque quelque chose, elle liste chaque élément dans Terminal avec une commande pour l’installer à la main, et vous invite à terminer la configuration sur la page. Elle ne pose aucune question dans Terminal.

Quand la passerelle tourne en arrière-plan, cette liste va dans son journal. Lancez `droidpier logs` pour la voir.

<!-- verify: phase 3 -->
La page affiche la même liste, avec la taille de téléchargement de chaque élément :

| Manquant | Ce que vous faites sur la page |
|---|---|
| Android SDK, `cmdline-tools`, `emulator`, `platform-tools`, image système | Installez un élément avec le bouton à côté, ou installez-les tous d’un coup. |
| Aucun AVD | Créez un appareil : choisissez un modèle d’appareil et une version d’Android. |
| Java, quand un élément en a besoin | Installez Android Studio, qui inclut Java, ou JDK 17 ou plus récent, puis rouvrez la page. La passerelle n’installe pas Java. |

<!-- verify: phase 3 -->
Rien n’est téléchargé ni créé tant que vous n’avez pas confirmé sur la page. Avant de commencer, la page indique ce qu’elle va télécharger, où cela sera installé et l’espace disque nécessaire. Pendant l’installation, la page affiche chaque licence Google en entier, et un élément n’est installé que si vous l’acceptez. Les outils en ligne de commande en version 23 ou plus récente peuvent accepter les licences sans demander ; la page vous le signale avant que vous confirmiez.

Par exemple, pour installer l’image système à la main :

```sh
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

## 3. Ouvrir la page {#3-open-the-page}

<!-- verify: phase 3 -->
Ouvrez `https://droid.devpier.dev/app/` dans Chrome ou Edge. Au démarrage, la passerelle affiche aussi cette adresse et l’ouvre dans votre navigateur par défaut. Si votre navigateur par défaut n’est ni Chrome ni Edge, ouvrez vous-même l’adresse dans Chrome ou Edge.

La page se connecte d’elle-même. Tant qu’aucune passerelle ne répond, elle vérifie une fois par seconde et se connecte dès que la passerelle démarre, sans rechargement. Elle ne vérifie pas tant que l’onglet est en arrière-plan.

Si la passerelle ne tourne pas sur le port `7300`, l’adresse qu’elle affiche se termine par `#port=<port>` :

```text
https://droid.devpier.dev/app/#port=7301
```

Ouvrez cette adresse pour que la page trouve le bon port.

## 4. Autoriser l’accès au réseau local {#4-allow-local-network-access}

<!-- verify: phase 3 -->
La première fois que la page se connecte à la passerelle sur votre Mac, Chrome affiche une demande d’autorisation pour savoir si `droid.devpier.dev` peut accéder à votre réseau local. Cliquez sur **Autoriser**. Chrome mémorise ce choix pour le site.

Si vous avez refusé, voir [Dépannage](/fr/docs/guides/troubleshooting/#chrome-blocked-local-network-access).

## 5. Utiliser l’émulateur

Si un émulateur avec gRPC est déjà en cours d’exécution, la page affiche son écran.

<!-- verify: phase 2 -->
Sinon, choisissez un appareil dans la liste et démarrez-le. Voir [Appareils](/fr/docs/guides/devices/).

Cliquez sur l’écran pour lui donner le focus clavier. Ensuite :

- Cliquez pour appuyer ; faites glisser pour balayer.
- Tapez sur le clavier de votre Mac. Voir [Clavier et saisie](/fr/docs/guides/keyboard-and-input/).
- Utilisez les boutons Retour, Accueil et Récents au-dessus de l’écran.

## Arrêter

Lancez `droidpier stop`. Si vous avez démarré la passerelle avec `droidpier` dans une fenêtre Terminal, appuyez plutôt sur `Ctrl+C` dans cette fenêtre. Les émulateurs en cours continuent de tourner. La prochaine fois que vous démarrez la passerelle, avec la même commande ou avec `droidpier start`, elle s’y reconnecte.

## La page de secours locale

La passerelle sert aussi elle-même la même page à `http://127.0.0.1:7300/app/` (ou sur le port que vous avez choisi). Utilisez-la si la page publique ne se charge pas ou n’arrive pas à se connecter.

Pour que la passerelle ouvre la page locale plutôt que la page publique, démarrez-la avec `--local` :

```sh
droidpier --local
```
