# PLAN-v1.5.1-UX — Licence institutionnelle, barre supérieure, thème unifié

> Owner request 2026-11-07 (pre-v1.5.1). Scope: UI only — no DAL, no fiscal math,
> no schema migration. Constitution v3-MKT + surgical-precision rules apply.

## 0. État des lieux (audité)

| Zone | Fichier | Constat |
|---|---|---|
| Licence | `src/components/License/LicenseManagerView.tsx` (277 l.) | Prix affiché 2× (`Tarif Unique: 5,000 DZD` + ligne 💰) ; identité BarakaDEV minimale (1 badge + 1 ligne) ; mise en page datée |
| Balance (haut) | `src/components/Navbar.tsx` (~l.387-409) | État lecture + bouton toggle `isHardwareScaleActive` — doublon avec barre POS |
| Balance (bas) | `src/components/POS/PosView.tsx` (F6 + `ScaleSimulationModal`) | Chemin canonique : `shortcuts.ts → pos.scale → modal` — **intouchable** |
| Thème | `src/index.css` (`html.light` overrides) + `force-dark` | Overrides partiels : hex durs hors-liste (`text-white`, dégradés, `amber-300`, `rose-950/60`…) ne basculent pas en clair |

## 1. Licence — reconstruction institutionnelle (sans prix)

Structure cible (4 blocs, AR/FR) :
1. **Hero BarakaDEV** — emblème + nom société + baseline « Algerian Retail Solutions » + badge édition (`Baraka Market v{APP_VERSION}`) + statut licence (pill actif/essai). **Aucun montant.**
2. **Carte institutionnelle** — qui sommes-nous (3 puces : éditeur algérien, 100% hors-ligne, conformité SCF) + canal d'acquisition (WhatsApp/téléphone existant, via revendeur agréé).
3. **Sanctuaire d'activation en 3 étapes** — timeline ① HWID + copier ② nom du magasin ③ clé → bouton activer ; alertes existantes conservées (rejet/drift/essai).
4. **Conditions de licence** — perpétuelle, 1 poste, liée au HWID, sans abonnement ni internet, support inclus ; pied de page sécurité Ed25519.

Suggestions institutionnelles du bureau (proposées, à valider) :
- (a) Mention « Licence perpétuelle — sans abonnement » **sans montant** (le prix vit au devis/facture, pas dans le produit).
- (b) Carte revendeur : « Obtenez votre clé auprès de votre revendeur agréé BarakaDEV ».
- (c) Badge édition + versionBrokered depuis `APP_VERSION` (traçabilité support).
- (d) Footer conformité : Ed25519 hors-ligne + SCF.

Interdits : aucun contact inventé (le +213 existant est conservé tel quel),
aucun prix, aucun outil vendor (keygen reste staff-only).

## 2. Balance — retrait du haut, F6 canonique vérifié

- Supprimer de `Navbar.tsx` : le span d'état + le bouton toggle + `Scale`
  de l'import + les 3 bindings `isHardwareScaleActive/setHardwareScaleActive/
  scaleWeightGrams` **si** inutilisés ailleurs dans le fichier.
- Intouchables : `PosView` F6, `ScaleSimulationModal`, `shortcuts.ts`,
  `AppContext` (le store reste la source),hardware lane T6.
- Réorganisation : l'espace libéré resserre le cluster droit
  (langue • thème • horloge • session) sans décalage — vérifié visuellement.
- Preuve : lane `pos-scale` — F6 ouvre le modal, poids simulé remplit la
  quantité ; capture Navbar avant/après.

## 3. Thème — audit page par page, unification par variables

Méthode (pas de big-bang) :
1. `grep` des hex durs (`bg-[#`, `text-white`, `from-/via-/to-`, `force-dark`)
   par vue ; chaque hex non couvert par `html.light` est soit mappé dans
   `index.css`, soit converti en `var(--…)` / classes `dark:`.
2. `force-dark` : réservé aux seuls scellés fiscaux/tickets (jamais aux pages).
3. Lane visuelle `theme-unified` : POS, Licence, Retours, Compta, Paramètres —
   captures dark + light (bascule via `baraka_theme_v2`), revue pixel par pixel.

## 4. Portes d'acceptation (chaque lot)

`tsc --noEmit` + `npm run lint` + suites concernées vertes + lane visuelle
avant/après + `git status` propre + commit conventionnel. Aucun `add -A`
(arborescence partagée avec l'Activation Desk).

## 5. Extension 2026-11-07 — bureau Retours + infos Licence (réponses owner)

- Retours : hero 4 portes + cartes 01/02/03 ; recherche tolérante côté DAL
  (exact → FACT-{année}-{pad6} → suffixe unique, lecture seule, miroir
  TS/Rust + tests) + normalisation vue (trim/upper/espaces) + autofocus.
- Licence : nom affiché « Baraka DEV », contacts (tél + BarakaDev.34@outlook.com
  + Cité 17 Octobre, Bordj Bou Arréridj — Algérie), sans horaires, sans
  numéros RC/NIF, prix toujours hors produit.
