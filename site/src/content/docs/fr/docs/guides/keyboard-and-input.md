---
title: Clavier et saisie
description: Comment la souris, le trackpad, le clavier, le texte non ASCII et les boutons de l’appareil parviennent à l’émulateur.
sourceHash: 34d7c6882a09
---

## Souris et trackpad

- **Appui :** cliquez sur l’écran.
- **Balayage :** appuyez, faites glisser, relâchez. La passerelle envoie le mouvement à l’émulateur comme un seul contact.
- Si vous faites glisser au-delà du bord de l’écran et relâchez à l’extérieur, l’émulateur reçoit quand même le relâchement, donc le contact ne reste pas enfoncé.

Les coordonnées de la page sont converties en pixels de l’appareil, en tenant compte de la taille de la page.

<!-- verify: phase 2 -->
Après une rotation de l’appareil, la conversion utilise la nouvelle orientation, donc les appuis tombent là où vous cliquez.

## Molette de défilement

<!-- verify: phase 2 -->
L’émulateur n’a pas d’entrée pour la molette, donc la page transforme le mouvement de la molette en un court balayage :

- Chaque tranche de 100 pixels de mouvement de molette devient un balayage de 300 pixels sur l’appareil, jusqu’à 900 pixels par balayage.
- Le balayage va dans le sens opposé à la molette : faire défiler vers le bas déplace le doigt vers le haut, comme sur un téléphone.
- Les événements de molette survenant dans un intervalle de 50 ms sont fusionnés en un seul balayage.

## Clavier

Cliquez d’abord sur l’écran. Il a alors le focus clavier.

- Les caractères imprimables et les touches de fonction (flèches, Entrée, Retour arrière, Tab, Échap, etc.) sont envoyés à l’émulateur dès que vous appuyez dessus.
- Les raccourcis du navigateur qui utilisent Cmd, comme Cmd+R et Cmd+W, ne sont pas interceptés. Ils agissent toujours sur le navigateur.

<!-- verify: phase 2 -->
Cmd+V colle depuis votre Mac. Voir [Presse-papiers](/fr/docs/guides/clipboard/).

## Chinois et autres textes non ASCII {#chinese-and-other-non-ascii-text}

Tapez avec n’importe quelle méthode de saisie de macOS. Lorsque la méthode de saisie a fini de composer un mot, la page :

1. place le texte dans le presse-papiers de l’émulateur ;
2. envoie un collage à l’émulateur.

Aucune application de méthode de saisie n’est installée sur l’émulateur. La contrepartie : cela écrase le presse-papiers de l’émulateur.

La saisie de touches de l’émulateur ignore les caractères non ASCII, c’est pourquoi ce texte passe par le presse-papiers.

## Boutons de l’appareil

Boutons au-dessus de l’écran :

| Bouton | Envoie |
|---|---|
| Retour | `GoBack` |
| Accueil | `GoHome` |
| Récents | `AppSwitch` |

<!-- verify: phase 2 -->
| Bouton | Action |
|---|---|
| Rotation | Fait pivoter l’appareil de 90° dans le sens des aiguilles d’une montre |
| Volume + / − | `AudioVolumeUp` / `AudioVolumeDown` |
| Alimentation | `Power` ; appuyez à nouveau pour rallumer l’écran |
| Capture d’écran | Télécharge un PNG. Voir [Captures d’écran](/fr/docs/guides/screenshots/) |
