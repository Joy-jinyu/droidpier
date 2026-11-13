---
title: Configuration requise
description: Ce qu’il vous faut avant d’installer Droidpier - un Mac avec Apple Silicon, Chrome ou Edge, et l’émulateur Android avec une image système arm64.
sourceHash: 39e85ecc70b3
---

Droidpier exécute l’émulateur Android officiel sur votre propre Mac et l’affiche dans un onglet du navigateur. Rien ne tourne sur un serveur distant. Vous installez un petit programme local (la passerelle), et il vous faut l’émulateur Android et une image système sur le même Mac.

## Ordinateur

- Un Mac avec Apple Silicon (M1 ou plus récent). La version 1 ne prend en charge que les Mac avec Apple Silicon et les images système arm64.
- Les Mac Intel, Windows et Linux ne sont pas pris en charge dans la version 1.

## Navigateur

- Google Chrome ou Microsoft Edge.
- Safari et Firefox ne sont pas pris en charge. Voir [Navigateurs pris en charge](/fr/docs/reference/browser-support/) pour la raison.

## Composants de l’Android SDK

La passerelle utilise ces parties de l’Android SDK :

| Composant | Sert à | Taille de téléchargement approximative |
|---|---|---|
| `emulator` | Exécute l’appareil virtuel Android | environ 400 MB |
| `platform-tools` | `adb`, pour vérifier l’état du démarrage et arrêter les appareils | environ 16 MB |
| Une image système, par exemple `system-images;android-34;google_apis;arm64-v8a` | Le système Android que l’appareil exécute. Toute version d’Android convient ; si aucune n’est installée, la page propose Android 14 (API 34) | environ 1.5 GB |

<!-- verify: phase 3 -->
Vous n’avez besoin ni de Java, ni des outils en ligne de commande (`sdkmanager`, `avdmanager`), ni d’Android Studio : la passerelle télécharge ces éléments depuis le dépôt SDK de Google et crée elle-même les appareils. Si vous avez déjà le SDK installé par Android Studio, la passerelle l’utilise. Elle cherche le SDK dans cet ordre :

1. Le répertoire indiqué dans la variable d’environnement `ANDROID_HOME`.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
S’il manque quelque chose, la passerelle vous indique quoi et vous demande avant de télécharger quoi que ce soit. Voir [Premier lancement](/fr/docs/getting-started/first-run/).

## Mémoire

<!-- verify: phase 3 -->
Chaque émulateur en cours d’exécution utilise la RAM définie dans la configuration de son appareil. L’appareil par défaut que la passerelle peut créer utilise 4096 MB. Un seul appareil est affiché à la fois.

## Performances mesurées {#measured-performance}

Sur un Mac M4 avec un appareil virtuel Pixel 5 API 34 (1080×2340) dans Chrome 157, avec le transport d’images rgba-mmap (images RGBA brutes via la mémoire partagée), l’écran s’est mis à jour à une médiane de 60 images par seconde, et la latence d’appui était de 20 ms au p50 et de 30 ms au p90. Vos chiffres dépendent de votre Mac, de l’appareil et du navigateur.

Le CPU a été mesuré sur la même configuration pendant 16 balayages enchaînés, en additionnant l’émulateur, la passerelle et le processus d’affichage (tous les processus Chrome). Droidpier a utilisé 257 % (émulateur 136 % + passerelle 69 % + Chrome 52 %). scrcpy, mesuré de la même façon avec le même émulateur, a utilisé 208 % (émulateur 203 % + scrcpy 5 %). Droidpier a donc utilisé 1.24 fois le CPU de scrcpy.
