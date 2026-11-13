---
title: Installation
description: Installez et démarrez la passerelle Droidpier sur un Mac avec Apple Silicon en une seule commande.
sourceHash: 721a09a23a56
---

La prise en main se fait en deux étapes :

1. Exécutez la commande ci-dessous dans Terminal. Elle installe Droidpier et le démarre en arrière-plan.
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
4. Démarre la passerelle en arrière-plan avec `droidpier start`.

La passerelle tourne en arrière-plan. Vous pouvez fermer la fenêtre Terminal : elle continue de tourner et redémarre quand vous ouvrez une session. Lancez `droidpier stop` pour l’arrêter et `droidpier status` pour vérifier son état.

Quand vous relancez la même commande :

- Si votre copie est à jour, elle saute le téléchargement et redémarre la passerelle.
- Si une version plus récente existe, elle met à jour votre copie puis redémarre la passerelle, pour que la nouvelle version tourne.
- Si le site de téléchargement est injoignable, elle vous avertit et démarre la copie que vous avez déjà.
- Si une passerelle tourne déjà dans une fenêtre Terminal, elle le signale et ne démarre rien. Arrêtez d’abord celle-ci avec `Ctrl+C`.

Pour passer des options à la passerelle, ou pour installer sans la démarrer, voir [Ligne de commande](/fr/docs/reference/cli/#start-with-the-install-command).

## Lancer droidpier directement

<!-- verify: phase 3 -->

Après l’installation, vous pouvez aussi utiliser la commande `droidpier`. `droidpier start` démarre la passerelle en arrière-plan, comme la commande d’installation. `droidpier` seul la fait tourner dans la fenêtre Terminal jusqu’à ce que vous appuyiez sur `Ctrl+C` :

```sh
droidpier start
```

Si votre shell indique `command not found`, `~/.local/bin` n’est pas dans votre `PATH`. Le script d’installation affiche alors une indication. Ajoutez-le, par exemple dans `~/.zshrc` :

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Ouvrez ensuite une nouvelle fenêtre Terminal et réessayez.

## Mettre à jour

<!-- verify: phase 3 -->

Relancez la même commande. Elle remplace le fichier dans `~/.local/bin` quand une version plus récente existe, et redémarre la passerelle pour que la nouvelle version tourne.

<!-- verify: phase 3 -->
Lorsque la page est plus récente que votre passerelle, la page vous indique que la passerelle n’est plus à jour et affiche la commande pour la mettre à niveau.

## Étape suivante

[Premier lancement](/fr/docs/getting-started/first-run/) : laissez la passerelle vérifier votre Android SDK, ouvrez la page et autorisez l’accès au réseau local.
