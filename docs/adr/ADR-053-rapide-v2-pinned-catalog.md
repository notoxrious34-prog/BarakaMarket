# ADR-053-MKT — Produit Rapide v2: Catalogue Léger Épinglé (P3→P5)

- **Status:** DECIDED (owner approval 2026-11-25 — full P3→P5 map, phased shipment) → P3 EXECUTING
- **Extends:** ADR-051 (P0/P1/P2 shipped v1.9.1/v1.9.2) · Study: `docs/ETUDE-rapide-v2-pinned-catalog.md`
- **Scope:** P3 NOW (this ADR's build) · P4/P5 DOCUMENTED, gated on P3 green gates

## §1 — Contexte et décision du propriétaire

Les produits sans code-barres réel (œufs, bonbons, fromage à la coupe, légumineuses au poids)
vivent aujourd'hui sous **fausses identités** (codes fictifs en stock). Le propriétaire a approuvé :
(1) la conception (§3), (2) le registre des risques et les alternatives rejetées de l'étude,
(3) les réponses §10 ci-dessous, (4) les 5 contrôles §4, (5) l'exécution immédiate de **P3**.

## §2 — Réponses du propriétaire (§10 de l'étude) — NORMATIVES

- **Q1 défauts tuile:** valeur **propriétaire** par article. `PIECE` : tap = ligne qté 1
  (ou `N*`) au prix fixé, **sans modale** (< 100 ms). `POIDS` : P3 autorise kind + prix/kg
  manuel obligatoire ; la fenêtre pesée rapide (chips 100/250/500/1000 g + badge
  «dernier usage») = **P4**.
- **Q2 touches:** `F2/F3/F4` **CONDITIONNELS** à l'absence de collision (§5 : collision
  AVÉRÉE → **rejetés**, remplacés par `#N` + `N*#N` + `Alt+1..9`, badges `#1..#12`).
- **Q3 stock:** `track_stock = false` par défaut pour tous ; activation par article
  (propriétaire) ; le stock négatif **ne bloque jamais** la vente (ADR-047).
- **Q4 prix/kg:** saisie manuelle **explicite et obligatoire** du propriétaire à la
  création/épinglage d'un `POIDS` ; en P5, suggestion pré-remplie (dernier prix libre)
  révisable avant sauvegarde.
- **Q5 portée:** carte complète **P3→P5 documentée**, exécution/livraison **par phases
  à grilles vertes** :
  - **P3 (cette livraison) :** articles `barcode = NULL` + `kind` + épinglage central,
    tuiles, `#N` + `N*#N` + `Alt+1..9`, garde **anti-fake**, permissions + audit, retours.
  - **P4 :** mode Pesée + détail mémo Z. — **P5 :** migration codes suspects + suggestion.

## §3 — Les 5 contrôles mondiaux (NORMATIFS, testés)

1. **Pas de `""` en barcode (P3) :** normalisation `"" → NULL` dans les DEUX lanes +
   `CHECK (barcode IS NULL OR length(trim(barcode)) > 0)`. (UNIQUE autorise NULL
   multiples mais refuse `""` répétés — c'est exactement le piège visé.)
2. **Prix verrouillé en saisie Montant-TTC inverse (P4) :** `line_ttc` saisi = référence
   financière ; `weight_g` dérivé pour affichage/impression uniquement ; **re-multiplication
   interdite** (±10 ct de dérive). En saisie poids : `line_ttc = HALF_UP((w−tare)×ppkg/1000)`.
3. **Chips poids & tare rapides (P4) :** `100/250/500/1000 g` + tares (`0g`, `15g`, `25g`,
   défaut article) → J3 < 3 s.
4. **Garde anti-fake clémente avec PLU (P3) :** avertissement + bouton 1-clic
   «Créer comme article épinglé sans code-barres (NULL)» ; **override explicite**
   propriétaire pour un vrai PLU balance (J5/B3).
5. **R2 façon Square (P3) :** max **12 tuiles visibles** (zéro-scrollbar) + groupes
   (`Tout / Quotidiens / Pesée / Saisonnier`) si > 12, avec `pin_order`.

## §4 — Conception P3 (cette livraison)

### 4.1 Schéma v16 → v17 (non-cassant, les DEUX lanes)
```sql
products: barcode TEXT NULL UNIQUE           -- NULL = légitime sans code
  + CHECK (barcode IS NULL OR length(trim(barcode)) > 0)
  + kind TEXT NOT NULL DEFAULT 'PIECE' CHECK (kind IN ('PIECE','POIDS','LIBRE'))
  + price_per_kg_ct INTEGER NULL            -- obligatoire si POIDS (garde applicative)
  + tare_g INTEGER NOT NULL DEFAULT 0
  + pin_order INTEGER NULL                  -- NULL = non épinglé ; 1..N = tuile #N
  + pin_color TEXT NULL + pin_icon TEXT NULL
  + track_stock INTEGER NOT NULL DEFAULT 0  -- Q3 : false par défaut
  + pinned_until TEXT NULL                  -- saisonnier (O3)
```
Migration idempotente (`ALTER TABLE` + `has_col`), `LATEST_SCHEMA_VERSION = 17` partout.
`product_barcodes` inchangé (un article sans code n'a pas d'alias).

### 4.2 Garde anti-fake (les DEUX lanes + UI)
Patterns : `^\d{1,6}$`, séquentiels (`1234…`, `000…`), `^(0|1|9)\1*$`, doublons suspects.
Déclenchement = **avertissement + 1-clic NULL** (jamais un refus sec — J7 reste < 15 s),
override propriétaire journalisé. `upsertProduct` normalise `"" → NULL` AVANT tout.

### 4.3 Vente (J1/J6)
- Tuile tap = `addToCart(produitDB, qty)` direct (PIECE, prix propriétaire) — pas de modale.
- `#N` dans le champ scan (+ `N*#N` via `parseQtyPrefix` existant) → résout `pin_order = N`.
- `Alt+1..9` (scope `pos`, hors inputs — le handler ignore déjà les non-F dans les inputs ;
  scope `pay` inchangé : montants) → tuile N. Badges `#N` sur tuiles.
- POIDS en P3 : tap ouvre le **modale rapide existant pré-rempli** (prix/kg, TVA) —
  la pesée plein-écran = P4.
- `*PRIX-LIBRE*`/`pid 0` intacts (J2/J11) ; groupes `pin_group` si > 12.

### 4.4 Retours / avoir (J8)
Les épinglés sont des produits réels (id) → chemin retours normal ; `return_items`
accepte déjà les lignes `pid 0` (ADR-051) — test explicite P3 pour les deux.

### 4.5 Permissions + audit (O2)
`catalog.create/pin/unpin/price` = **propriétaire uniquement** ; `AuditAction` étendue ;
Q4 manuel obligatoire ; prix/kg modifié = (de/vers/quand/qui).

## §5 — Déviation documentée : F2/F3/F4 REJETÉS (condition résolutoire)
Vérifié dans le code : `src/core/shortcuts.ts:25-27` + corps PosView (`pos.qty/discount/
hold`) — F2/F3/F4 **occupés**. La condition du propriétaire («après vérification»)
échoue → les 3 touches **ne sont pas** réaffectées. Couverture J6 assurée par
`#N` + `N*#N` + `Alt+1..9` (sans collision : scope `pos` libre, `pay` préempté).
Réaffectation F = nouvelle décision propriétaire si besoin (le registre est remappable).

## §6 — P4/P5 (DOCUMENTÉS, non construits)
P4 : Pesée plein-écran + chips + tare + contrôle n°2 + détail mémo Z (hors `z_hash`).
P5 : rapport codes suspects + adoption article-par-article + suggestion auto (≥ N usages).
Reportés : photos, étiquettes internes, multi-magasins.

## §7 — Grilles P3 (bloquantes)
G1 `lint` · G2 `npm test` (incl. **nouveaux** : garde anti-fake 2 lanes, `#N`/`Alt`,
NULL-barcodes multiples, retours épinglés) · G3 `cargo` · G4 `build` · G5 preuve live
(J1 < 3 s chrono, tap-tuile < 100 ms ressenti, `#1`+`4*#1`) + `final-sweep`
(AR/FR × dark/light × 1024×650).
Constitution : centimes/HALF_UP, TVA 0/9/19, `seq`+`z_hash` intacts, dual-lane parity,
RED→GREEN (chaque test échoue AVANT, passe APRÈS).
