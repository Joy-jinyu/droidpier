---
title: Presse-papiers
description: Copiez et collez du texte entre votre Mac et l’émulateur Android dans les deux sens.
sourceHash: fd58b697773c
---

## Du Mac vers l’émulateur

<!-- verify: phase 2 -->
Copiez du texte sur votre Mac. Cliquez sur l’écran de l’émulateur, puis appuyez sur Cmd+V :

- Le texte ASCII est tapé dans l’émulateur caractère par caractère.
- Le texte contenant d’autres caractères (chinois, emoji, etc.) est placé dans le presse-papiers de l’émulateur puis collé. Cela remplace ce qui se trouvait dans le presse-papiers de l’émulateur.

## De l’émulateur vers le Mac

<!-- verify: phase 2 -->
Copiez du texte dans Android, par exemple en appuyant longuement puis en choisissant copier. La passerelle surveille le presse-papiers de l’émulateur et envoie le nouveau texte à la page. La page l’écrit ensuite dans le presse-papiers de votre Mac, et vous pouvez le coller avec Cmd+V n’importe où sur votre Mac.

<!-- verify: phase 2 -->
Les navigateurs n’autorisent une page à écrire dans le presse-papiers que lorsqu’elle a le focus. Si l’écriture échoue, par exemple parce qu’une autre fenêtre était au premier plan, la page affiche un avis. Cliquez dessus pour copier le texte.

## Saisir du texte non ASCII

La saisie de texte chinois ou d’autres textes non ASCII avec une méthode de saisie de macOS passe aussi par le presse-papiers de l’émulateur. Voir [Clavier et saisie](/fr/docs/guides/keyboard-and-input/#chinese-and-other-non-ascii-text).
