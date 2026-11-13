---
title: Installation
description: Installez et démarrez la passerelle Droidpier sur un Mac avec Apple Silicon en une seule commande.
sourceHash: 9e0b6fc5fcb6
---

La prise en main se fait en deux étapes :

1. Exécutez la commande ci-dessous dans Terminal et laissez la fenêtre ouverte. Elle installe Droidpier et le démarre.
2. Ouvrez `https://droid.devpier.dev/app/`. La page se connecte d’elle-même. La première fois, quand Chrome demande si la page peut accéder à votre réseau local, cliquez sur **Autoriser**.

L’étape 2 est décrite dans [Premier lancement](/fr/docs/getting-started/first-run/).

<!-- verify: phase 3 -->
La commande `droidpier` est la passerelle : un unique fichier exécutable qui relie l’émulateur Android de votre Mac à la page du navigateur. Vous n’avez pas besoin de Node.js pour l’exécuter.

## Lancer la commande

<!-- verify: phase 3 -->

Vérifiez d’abord la [configuration requise](/fr/docs/getting-started/requirements/). Puis exécutez ceci dans Terminal :

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

La première fois, le script :

1. Télécharge la passerelle pour macOS sur Apple Silicon, `droidpier-darwin-arm64.tar.xz`, depuis `https://droid.devpier.dev/download/`. Sa somme de contrôle se trouve à côté, dans `droidpier-darwin-arm64.tar.xz.sha256`.
2. Vérifie le téléchargement avec la somme de contrôle. S’ils ne correspondent pas, il s’arrête et n’installe rien.
3. Enregistre la passerelle sous `~/.local/bin/droidpier` et la rend exécutable.
4. Démarre la passerelle.

La passerelle continue de tourner dans cette fenêtre Terminal. Laissez la fenêtre ouverte pendant que vous utilisez la page. Appuyez sur `Ctrl+C` pour l’arrêter.

Quand vous relancez la même commande :

- Si votre copie est à jour, elle saute le téléchargement et démarre la passerelle.
- Si une version plus récente existe, elle met à jour votre copie, puis la démarre.
- Si le site de téléchargement est injoignable, elle vous avertit et démarre la copie que vous avez déjà.
- Si la passerelle tourne déjà, elle vous le signale et ouvre la page. Elle n’en démarre pas une deuxième.

Pour passer des options à la passerelle, ou pour installer sans la démarrer, voir [Ligne de commande](/fr/docs/reference/cli/#start-with-the-install-command).

## Lancer droidpier directement

<!-- verify: phase 3 -->

Après l’installation, vous pouvez aussi démarrer la passerelle avec la commande `droidpier` :

```sh
droidpier
```

Si votre shell indique `command not found`, `~/.local/bin` n’est pas dans votre `PATH`. Le script d’installation affiche alors une indication. Ajoutez-le, par exemple dans `~/.zshrc` :

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Ouvrez ensuite une nouvelle fenêtre Terminal et réessayez.

## Mettre à jour

<!-- verify: phase 3 -->

Relancez la même commande. Si une version plus récente existe, elle remplace le fichier dans `~/.local/bin`. Si la passerelle tourne encore, arrêtez-la d’abord avec `Ctrl+C`, pour que la commande démarre la nouvelle version.

<!-- verify: phase 3 -->
Lorsque la page est plus récente que votre passerelle, la page vous indique que la passerelle n’est plus à jour et affiche la commande pour la mettre à niveau.

## Étape suivante

[Premier lancement](/fr/docs/getting-started/first-run/) : laissez la passerelle vérifier votre Android SDK, ouvrez la page et autorisez l’accès au réseau local.
