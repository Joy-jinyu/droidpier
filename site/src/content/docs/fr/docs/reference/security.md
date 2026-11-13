---
title: Sécurité
description: Comment la passerelle empêche d’autres pages web et d’autres ordinateurs de contrôler votre émulateur - bouclage uniquement et une liste d’origines autorisées.
sourceHash: 08642471687c
---

La page est servie depuis `droid.devpier.dev`, mais l’émulateur et la passerelle tournent sur votre Mac. N’importe quelle page web que vous ouvrez pourrait tenter de se connecter à un programme sur votre Mac, c’est pourquoi la passerelle vérifie chaque connexion.

## Bouclage uniquement

La passerelle écoute uniquement sur `127.0.0.1`. Elle n’accepte pas de connexions depuis votre réseau local ni depuis Internet. Les autres ordinateurs ne peuvent pas l’atteindre.

## Liste d’origines autorisées

<!-- verify: phase 3 -->
Les navigateurs envoient un en-tête `Origin` lorsqu’une page ouvre un WebSocket, et une page web ne peut pas le falsifier. La passerelle n’accepte de connexions que depuis la page publique sur `droid.devpier.dev` et sa propre page locale, c’est-à-dire uniquement depuis ces origines :

- `https://droid.devpier.dev`
- `http://127.0.0.1:<port>`
- `http://localhost:<port>`

<!-- verify: phase 3 -->
Une connexion avec toute autre origine, ou sans origine, est fermée avec le code `4003`. Une page d’un autre site ne peut pas contrôler votre émulateur, même si elle devine le port.

## Comment la page trouve la passerelle

<!-- verify: phase 3 -->
- Tant qu’aucune passerelle ne répond, la page sur `droid.devpier.dev/app/` la recherche une fois par seconde et se connecte dès que `droidpier` tourne. Elle ne vérifie pas tant que l’onglet est en arrière-plan.
- Elle utilise le port `7300`, ou le port indiqué après `#port=` dans l’adresse. La passerelle ajoute `#port=<port>` à l’adresse qu’elle ouvre uniquement quand elle ne tourne pas sur le port `7300`.
- La page n’enregistre pas le port dans le navigateur.

## Le site web ne se connecte pas à votre Mac

<!-- verify: phase 3 -->
L’autorisation d’accès au réseau local de Chrome et la vérification d’origine de la passerelle fonctionnent toutes deux par site, et non par chemin. Les pages de documentation partagent donc l’autorisation avec la page de l’émulateur sous `/app/`. Pour limiter ce que cela implique :

- Seule la page de l’émulateur sous `/app/` se connecte à la passerelle. La page d’accueil et cette documentation ne le font jamais, donc les lire ne déclenche pas la demande d’autorisation.
- Le site ne charge aucun script, style, police ou média tiers. Tout est servi depuis `droid.devpier.dev`.

## Installation de logiciels

<!-- verify: phase 3 -->
La passerelle n’installe jamais de paquets de l’Android SDK et ne crée jamais d’appareils sans demander. Vous confirmez chaque installation ou nouvel appareil sur la page, après qu’elle vous a montré ce qui sera téléchargé et où. La page affiche les licences de Google en entier, et un élément n’est installé que si vous l’acceptez. Les outils en ligne de commande en version 23 ou plus récente peuvent accepter les licences sans demander ; la page vous le signale avant que vous confirmiez. La passerelle ne pose aucune question dans Terminal.

## Codes de fermeture de connexion

<!-- verify: phase 3 -->
| Code | Signification |
|---|---|
| `4000` | Le premier message n’était pas `hello`. |
| `4002` | La page et la passerelle utilisent des versions de protocole différentes. |
| `4003` | Origine non autorisée. |

## Signaler un problème

Ouvrez une issue sur [github.com/twosugar/droidpier](https://github.com/twosugar/droidpier/issues).
