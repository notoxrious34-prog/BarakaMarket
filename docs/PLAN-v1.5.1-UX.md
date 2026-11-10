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

## 6. Correctifs caisse 2026-11-07 — F3 + F6 (signalement owner, preuve live)

- **F3 Remise ciblait la mauvaise ligne** : `editingItemIndex` collant
  (jamais réinitialisé après scans/suppressions/encaissement) → F3 éditait
  la première ligne au lieu de la dernière scannée, ou rien (index périmé).
  Règle : F3/F2 visent toujours la dernière ligne scannée ; état collant
  supprimé. + **vol de focus** : le réarmement auto du champ code-barres se
  déclenchait aussi à l'OUVERTURE des modales (course avec l'autofocus du
  modal) → touches perdues derrière la modale. Le réarm ne se fait que quand
  toutes les modales sont fermées (index numérique 0 = ouvert).
- Preuve live (lane-f3, sombre+clair) : 3 lignes → F3 ouvre sur la DERNIÈRE
  (CHOCOLAT) → 10 % appliqué sur la bonne ligne ; F6 ouvre le bureau repensé.
- **F6 Balance repensée en bureau 1·2·3** : en-tête (statut SIMU/STABLE) +
  1·choix article avec recherche instantanée, 2·plateau LED + molettes
  ±50/±100 g + presets + lien live RS-232/USB, 3·ticket à injecter
  (code-barres + total). Revue visuelle : sombre 9/10, clair sans îlots.

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

## 6. Extension 2026-11-10 — دفتر المبيعات v1.5.2 (P1–P4, ADR-043)

- **P1 قائمة اليوم** (`sqlite.ts listSalesByDay` + `GET /api/sales/day/:day`): حدود
  `fiscalDayBoundsUTC`، الأحدث أولًا، `client_name` عبر JOIN + علَم AVOIR +
  إظهار CANCELLED. **P2 Duplicata محوكم** (`POST /api/sales/:id/duplicata` →
  `sale.duplicata` بالفاعل/السبب قبل الطباعة + ختم DUPLICATA على الورق؛ رفض
  ودود للجلسة بلا تصريح).
- **P3 فلاتر + CSV** (توابع نقية في `sales-book-authority.ts` + اختبارات وحدوية):
  بحث FACT/تذكرة متسامح، كاشير (مشتق من الصفوف)، طريقة دفع، شرائح
  (الكل/AVOIR/ملغاة + زبون)، تصدير `ventes-{day}.csv` (FR/AR + BOM).
  الترشيح في الذاكرة — سطح الخادم بلا تغيير.
- **P4 بطاقة الصحة**: المجموع − AVOIR = الصافي + نقدي/بنكي+كريدي + شارة
  مطابقة ضد `GET /api/z/summary` (نفس النافذة). الملغاة تُعَدّ خارج المجموع.
- **الإثبات**: `lane-sb` (قائمة + تفاصيل + رفض محوكم + تذكرة مختومة) و`lane-p34`
  (بطاقة + فلتر FACT + شريحة AVOIR + تنزيل CSV حقيقي) — داكن + فاتح PASS بلا أخطاء.
  `sales-book.test.ts` 5/5 (يوم + AVOIR + فلاتر + صحة + CSV)؛ المجاميع رُوجعت يدويًا
  (1630 − 180 = 1450: الإرجاع الجزئي 1000/2000 مللي بسعر 180 = 180.00 دج).

## 7. Correctif 2026-11-10 — دفتر المبيعات في الصندوق المثبت (v1.5.3, T12-bis)

- **العرض الميداني**: النسخة المثبتة v1.5.2 تعرض `lane unreachable` في تبويب
  المبيعات (لقطة المستخدم) — القراءة كانت عبر loopback فقط، ولا خادم loopback
  داخل الـ exe. نفس عيب T12 حرفيًا.
- **الإصلاح**: أوامر أصلية `sales_book_day` (صفوف اليوم + إجمالي Z) و`sale_head`
  و`sale_duplicata` (التدقيق في نفس الاستدعاء) + تحويل كل دوال
  `sales-book-authority` إلى invoke-first (loopback يبقى للتطوير فقط).
  اختبار Rust جديد `sales_book_day_head_and_duplicata_for_the_installed_shell`.
- **القاعدة الملزمة**: أي سطح جديد في التطبيق المثبت يجب أن يمتلك قناة invoke
  أصلية منذ اليوم الأول — الـ loopback للمتصفح والتطوير فقط.
