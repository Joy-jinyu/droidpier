---
title: Navigateurs pris en charge
description: Droidpier prend en charge Chrome et Edge. Safari bloque la connexion à la passerelle locale, et Firefox n’est pas pris en charge.
sourceHash: f0d75b070eb1
---

| Navigateur | Pris en charge |
|---|---|
| Google Chrome | Oui |
| Microsoft Edge | Oui |
| Safari | Non |
| Firefox | Non |

Les mesures de la page [Configuration requise](/fr/docs/getting-started/requirements/#measured-performance) ont été réalisées dans Chrome 157.

## Pourquoi Safari ne fonctionne pas

La page est servie en `https`, et elle se connecte à la passerelle sur votre Mac avec `ws://127.0.0.1` (ou `ws://localhost`), qui n’est pas chiffré. Safari considère cela comme du contenu mixte (une connexion non sécurisée depuis une page sécurisée) et le bloque. La page ne peut pas atteindre la passerelle dans Safari.

## Firefox

Firefox n’est pas pris en charge.

## Comment la page vérifie le navigateur

<!-- verify: phase 3 -->
La page lit `navigator.userAgentData.brands`. Elle continue uniquement si la liste contient `Google Chrome` ou `Microsoft Edge`. Sinon, elle vous demande d’ouvrir la page dans Chrome ou Edge et ne tente pas de se connecter.

<!-- verify: phase 3 -->
Safari et Firefox ne fournissent pas `navigator.userAgentData`, ils sont donc refusés. Les autres navigateurs basés sur Chromium qui ne déclarent pas la marque Chrome ou Edge sont refusés également.

## Accès au réseau local dans Chrome

<!-- verify: phase 3 -->
- Depuis Chrome 147, une page `https` publique qui se connecte à `localhost` doit d’abord obtenir l’autorisation de l’utilisateur. Chrome demande une fois et mémorise la réponse pour le site.
- Depuis Chrome 154, la page peut indiquer qu’elle se connecte à l’adresse de bouclage (`targetAddressSpace: "loopback"` à l’ouverture du WebSocket). La page le fait, et se rabat sur un WebSocket simple dans les versions qui ne prennent pas en charge cette option.
- Depuis Chrome 156, une stratégie d’entreprise ne peut plus désactiver cette vérification.

Si vous avez refusé l’autorisation, voir [Dépannage](/fr/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
