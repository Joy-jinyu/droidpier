---
title: Ligne de commande
description: Options et variables d’environnement de la commande de la passerelle Droidpier.
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

La passerelle tourne au premier plan jusqu’à ce que vous appuyiez sur `Ctrl+C`. L’arrêter n’arrête pas les émulateurs en cours d’exécution.

## Démarrer avec la commande d’installation {#start-with-the-install-command}

La commande d’installation, `curl -fsSL https://droid.devpier.dev/install.sh | sh`, installe ou met à jour la passerelle, puis la démarre. Pour passer des options à la passerelle, placez-les après `sh -s --` :

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Pour installer ou mettre à jour sans démarrer la passerelle, définissez `DROIDPIER_NO_START=1` :

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

## Options

| Option | Par défaut | Effet |
|---|---|---|
| `--port <port>` | `7300` | Le port sur lequel la passerelle écoute, uniquement sur `127.0.0.1`. |

<!-- verify: phase 3 -->
| Option | Par défaut | Effet |
|---|---|---|
| `--local` | désactivé | Ouvre la page que la passerelle sert elle-même, `http://127.0.0.1:<port>/app/`, au lieu de la page publique sur `droid.devpier.dev`. |
| `--no-open` | désactivé | N’ouvre pas le navigateur au démarrage. La passerelle affiche quand même l’adresse. |

Avec ou sans `--no-open`, la page trouve la passerelle d’elle-même. Voir [Premier lancement](/fr/docs/getting-started/first-run/#3-open-the-page).

## Variables d’environnement

| Variable | Effet |
|---|---|
| `ANDROID_HOME` | Le répertoire de l’Android SDK. Sans elle, la passerelle utilise `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | Le répertoire qui contient les AVD. Sans elle, la passerelle utilise `~/.android/avd`. |
| `DEBUG=1` | Affiche une ligne par seconde pour chaque connexion : images reçues, envoyées et abandonnées, taille moyenne des images, et délai entre l’émulateur et la passerelle. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` est lue quand la passerelle liste les appareils.

<!-- verify: phase 3 -->
`ANDROID_HOME` est lue par la vérification du premier lancement.

## Ce qu’elle affiche

Au démarrage, la passerelle affiche l’adresse de la page. Si aucun émulateur ne tourne, elle affiche la raison et continue de tourner.

<!-- verify: phase 3 -->
Par défaut, l’adresse affichée est celle de la page publique, `https://droid.devpier.dev/app/`. Quand la passerelle ne tourne pas sur le port `7300`, l’adresse se termine par `#port=<port>`. Avec `--local`, c’est celle de la page locale, `http://127.0.0.1:<port>/app/`. La passerelle ouvre l’adresse avec la commande macOS `open`, sauf si vous passez `--no-open`.

Si une passerelle tourne déjà sur le port, une deuxième ne démarre pas. Elle affiche que droidpier tourne déjà, avec le port, et ouvre la page. Si un autre programme utilise le port, elle le signale, propose un autre port et s’arrête.

<!-- verify: phase 3 -->
Quand des parties de l’Android SDK manquent, la passerelle liste chacune avec une commande pour l’installer à la main, et vous invite à terminer la configuration sur la page. Elle ne pose jamais de question dans Terminal : les installations, les nouveaux appareils et les licences se confirment sur la page. Voir [Premier lancement](/fr/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Fichiers et ports utilisés

| Quoi | Où |
|---|---|
| Adresse d’écoute de la passerelle | `127.0.0.1:<port>` |
| Détection des émulateurs en cours d’exécution | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| Quoi | Où |
|---|---|
| Ports gRPC qu’elle attribue aux émulateurs | Le premier port pair libre à partir de `8554` |

<!-- verify: phase 3 -->
| Quoi | Où |
|---|---|
| Exécutable installé | `~/.local/bin/droidpier` |
| Somme de contrôle de la version installée | `~/.local/share/droidpier/installed.sha256` |
