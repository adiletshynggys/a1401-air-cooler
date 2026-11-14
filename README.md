# A-1401 syngas air cooler model

Static website that models the A-1401 forced-draft air cooler in the hydrogen plant cooling train (Atyrau), built for the AIChE Catalyst hackathon. It shows what debris on the fins does to the cooler. Debris hurts in two ways at once:

1. **It resists the air.** Packed fin gaps steepen the system curve, so the same fans move less air.
2. **It insulates the fins.** Buried fin area stops working, and the debris layer adds a thermal resistance.

More fan output cannot win this back: the fan power rises with the cube of speed while the duty barely moves.

No build step. Plain HTML/CSS/JS, three.js and Chart.js from a CDN with local copies in `vendor/`, so `index.html` also opens offline straight from disk.

| Tab | What it shows |
|---|---|
| Process overview | Animated flow diagram R-1405 → E-1406 → E-1407 → E-1408 → A-1401 → E-1409 → E-1410 → D-1403 → PSA / flare, with T, P and flow at each point; X, Y, Z and the A-1401 heat load for the Design / Winter 24-25 / Summer 2025 / Now scenarios (`data/scenarios.json`). |
| A-1401 simulator | 3D model (3 sections, 6 bundles, 6 rows, forced-draft fans, plenum, optional steam coil) coloured by gas temperature cell by cell, debris shell that follows the fouling sliders, and air particles whose speed follows the computed face velocity. Sliders, readouts and five charts: (a) fan vs system curve; (b) duty and outlet T vs blockage at 0/20/35 °C; (c) duty and gas temperature row by row; (d) duty vs fan power, clean vs fouled; (e) 137 °C design vs 167 °C actual inlet. |
| Plant data | Load the hourly CSV in the browser (nothing is uploaded). Frozen and shutdown hours are excluded, then outlet T, fan output and flow are plotted, with hours at fans ≥ 99 % highlighted. Hourly Atyrau airport (UATG) air temperatures are built in, so the daily cleanliness factor UA_actual / UA_clean_model is computed as soon as the plant CSV is loaded. Another weather CSV (`timestamp, T_amb`) can be dropped in to replace it. |
| Validation | Calibration targets vs the model, fitted fouling, cleanliness factor and energy-balance closure, computed live. |

## Run

```bash
# open directly
start index.html            # Windows; or double-click it

# or serve it
python -m http.server 8000  # then http://localhost:8000

# physics tests (node ≥ 18, no dependencies)
node --test tests/model.test.js
```

Deployment: push to `main` and the workflow in `.github/workflows/pages.yml` runs the tests and publishes the folder to GitHub Pages. In the repository settings, set Pages → Source to "GitHub Actions".

**Plant data is not in the repository.** `.gitignore` excludes `*.csv`/`*.tsv` in `data/` because the hourly export may be confidential. The Plant data tab reads it from your disk when you choose or drop the file. The one exception is `data/weather_uatg.csv`, public METAR data (see below).

## Files

```
index.html            single page, four tabs (hash routing)
css/style.css         light theme, one accent colour
js/model.js           ALL physics (documented, UMD: browser + node)
js/overview.js        flow diagram
js/scene3d.js         three.js model + minimal orbit controls
js/simulator.js       sliders, readouts, charts (a)–(e)
js/plant.js           CSV loading, cleaning, cleanliness factor
js/validation.js      calibration panel
data/scenarios.json   output of tools/balance.py (scenarios.js = same data for file://)
tools/balance.py      plant mass and energy balance that produced scenarios.json
tools/weather.js      downloads UATG METAR → data/weather_uatg.csv/.js, prints scenario ambients
data/weather_uatg.*   hourly air temperature, Atyrau airport, Nov 2023 – Nov 2026
tests/model.test.js   14 unit tests (node:test)
vendor/               three.js r149, Chart.js 4.4.1 (offline fallback)
```

## Model (js/model.js)

### Geometry (drawing GP10.5×3-6-226-4.0S-23.4/DR)

Six bundles, 10.5 m tubes, 3 m wide, 6 rows, 226 m² bare per bundle, fin ratio 23.4. Tubes 25 × 2.5 mm Q345E with bimetallic rolled Al fins.

| Quantity | Value | Source |
|---|---|---|
| Tubes per bundle | 274 = 226 / (π · 0.025 · 10.5) | back-calculated |
| Transverse pitch P_t | 3 m / (274/6) = 65.7 mm, equilateral staggered | back-calculated |
| Fin root d_r | 26 mm (25 mm tube + ~0.5 mm Al liner) | **assumption** |
| Fin OD D_f | 56.9 mm → fin height 15.45 mm | back-calculated to fin ratio 23.4 |
| Fin density, thickness | 11 fpi, 0.40 mm | **assumption** (typical) |
| Finned area | A_o' = N_f[2·π/4·(D_f² − d_r²) + π·D_f·t] + π·d_r(1 − N_f·t) = 1.841 m²/m → 31,781 m² | check: drawing 6 × 5,288 = 31,728 m² |
| Fin ratio | 23.44 | drawing 23.4 |
| Free-flow fraction σ | (P_t − d_r − (D_f − d_r)·t·N_f)/P_t = 0.523; between-fin part σ_gap = 0.389; fin-tip clearance 0.134 | geometry |

### Tube side: wet syngas

- Dry gas (D-1403 lab, Jan–Mar 2026): H₂ 74.5 %, CO₂ 17.6 %, CH₄ 4.8 %, CO 2.2 %, N₂ 0.9 %. MW_d = 10.886 kg/kmol, c_p,d = 31.27 kJ/kmol K (as in balance.py). Vapour c_p,v = 34.0 kJ/kmol K.
- Pressure falls linearly along the gas path from 2.739 to 2.705 MPa abs (26.90 / 26.55 kgf/cm² g).
- Saturated at the inlet (the P&ID marks the line two-phase). Water vapour per kmol of dry gas: w = p_sat(T) / (P − p_sat(T)).
- p_sat: Wagner & Pruss (1993) auxiliary equation of IAPWS-95, error < 0.01 %.
  ln(p/p_c) = (T_c/T)(a₁τ + a₂τ^1.5 + a₃τ³ + a₄τ^3.5 + a₅τ⁴ + a₆τ^7.5), τ = 1 − T/T_c.
- Latent heat: h_fg = 2256.4 · ((T_c − T)/(T_c − 373.15))^0.32 kJ/kg, a Watson form fitted to steam tables, within 0.5 % for 0–200 °C.
- Heat released between T₁ and T₂ (the same method as balance.py):
  Q = ṅ_d c_p,d ΔT + ½(ṅ_v1 + ṅ_v2) c_p,v ΔT + (ṅ_v1 − ṅ_v2) M_w h_fg(T̄)
- Gas-side h: Dittus–Boelter Nu = 0.023 Re^0.8 Pr^0.3 (laminar floor 3.66) with mixture properties from simple mixing rules (**assumption**, ±20 %).
- Condensation with non-condensables, Silver–Bell–Ghaly: 1/h_i = 1/h_film + Z/h_gas, where Z = sensible / total heat released in the cell and h_film = 2000 W/m²K (range 1500–3000, **assumption**).
- Passes: 6, one row per pass, gas enters the top row (**assumption**; consistent with the ~34 kPa tube-side Δp). The 1, 2 and 3-pass options are in the simulator.
- Wall: R_w' = ln(d_o/d_i)/(2πk_w), k_w = 44 W/m K.

### Air side

- **Briggs & Young (1963)**, high-finned staggered tubes:
  h = 0.134 (k/d_r) Re^0.681 Pr^(1/3) (s/l)^0.2 (s/t)^0.1134, with Re = d_r G_max / μ and G_max = ṁ_air / (A_face σ).
- **Fin efficiency**, Schmidt approximation for annular fins:
  η_f = tanh(m r_b φ)/(m r_b φ), m = √(2h_eff/(k_f t)), φ = (r_e/r_b − 1)(1 + 0.35 ln(r_e/r_b)), r_e = D_f/2 + t/2. k_f = 220 W/m K (Al) or 45 (steel).
- **Bundle Δp, Robinson & Briggs (1966)**, per row: Δp = 2 f G²/ρ, f = 9.465 Re^−0.316 (P_t/d_r)^−0.927 (P_t/P_d)^0.515.

### Fouling: why debris counts twice

For a fouled row with a fraction φ of the fin gaps packed and a debris film resistance R_f (m²K/W on the finned surface):

- **Flow resistance.** The free area falls to σ_φ = σ − φ·σ_gap. Robinson–Briggs is evaluated at the higher G = ṁ/(A_face σ_φ), plus a Borda–Carnot loss coefficient K = (σ/σ_φ − 1)² on the clean-area velocity head.
- **Insulation.**
  - h_eff = 1/(1/h + R_f). Fin efficiency is computed with h_eff.
  - Packed fins are buried: per metre of tube, the air-side conductance is
    UA'_air = h_eff [(1 − φ)(A_fin' η_f + A_bare') + φ · π D_f η_f].
    In words, the packed part transfers heat only through its envelope.
- Fouling location: bottom row only; bottom two rows (row 1 full, row 2 at half); or all rows. A steam coil on the air inlet, when present, always gets the blockage.

Overall, per metre of tube: 1/UA' = 1/(h_i π d_i) + R_w' + 1/UA'_air.

### Fans and the operating point

- Generic axial fan curve per fan: Δp = Δp₀ (s² − (q/Q₀)²), where s = fan output (treated as speed), Δp₀ = ψ₀ ρ u², Q₀ = φ₀ u D², u = π D n / 60 · k_fan. ψ₀ = 0.065 and φ₀ = 0.28 (**assumption**). This obeys the affinity laws: Q ∝ s, Δp ∝ s², P ∝ s³.
- Fans: 6 × Ø 4.2 m at 250 rpm (**assumption**, no fan datasheet). Two fans per 10.5 × 6 m bay (63 m²). API 661 asks for ≥ 40 % fan coverage of the bay face, which needs Ø ≥ 4.0 m; 4.2 m is the next standard size. 250 rpm gives a 55 m/s tip speed, under the API 661 limit of 60 m/s. Checks: face velocity 2.2 m/s at 100 % (typical 2–3.5 m/s) and about 22 kW shaft power per fan in summer (a 30 kW motor class). The earlier team estimate, Ø 2.4 m at 480 rpm, covers only 14 % of the face; it stays reachable on the sliders and changes the fitted fouling by only ~5 %.
- System curve: Σ row Δp (+ steam coil row) + K_plenum · ½ ρ v_fan², with K_plenum = 1.5 (**assumption**).
- The operating point is the bisection intersection of the two curves. Fan shaft power = Q Δp / η_fan, η_fan = 0.70 (**assumption**); electric power uses η_motor = 0.93.

### Solver

- Counter-crossflow, cell by cell: 6 rows × 16 segments along the tube.
- Air rises bottom → top through every row. Each column along the tube keeps its own air temperature (air unmixed).
- Gas enters the top pass and works downward. The flow direction alternates between passes.
- Each cell is solved with ε-NTU for crossflow with the gas side mixed: ε = (1/C_r)(1 − exp(−C_r(1 − e^−NTU))). The gas capacity is the local secant of the condensing-gas enthalpy curve, iterated three times. The gas outlet temperature comes from Newton iteration on the enthalpy.
- The air field is iterated (Gauss–Seidel) until the inlet air temperatures change < 10⁻⁴ K, typically 5–30 sweeps.
- **Energy balance closure.** The sum of cell duties is compared with an independent 400-step integral of the gas enthalpy from inlet to outlet. Closure is < 0.1 % in normal operation, and the tests assert < 1 % across the range. The air-side check ṁ c_p ΔT_air vs Σ Q also closes.

## Calibration and what it shows

Targets:

| Case | Inlet → outlet | Flow | Fans | Ambient | Duty (balance.py) |
|---|---|---|---|---|---|
| Design (P&ID) | 137 → 60 °C | 21,000 Nm³/h | 100 % | 38 °C **assumption** (1 % summer exceedance at UATG) | 2.0 MW |
| Winter 2024–25 | 166.1 → 78.9 °C | 24,119 Nm³/h | 77 % | −3.4 °C, measured | 4.84 MW |
| 14 Nov 2026 | 166.9 → 65.1 °C | 20,979 Nm³/h | 88 % | 7 °C, measured | 4.50 MW, 80 % latent |
| Summer 2025 | 160.7 → 72.3 °C | 18,122 Nm³/h | 99 % | 25.9 °C, measured | 3.17 MW |

Ambient temperatures are hourly METAR observations at Atyrau airport (UATG) from the Iowa Environmental Mesonet archive, averaged over the same period as each plant case (`node tools/weather.js`). Winter and summer are means over all hours of the period; 14 Nov is the 14:00 value.

Only fan scaling and fouling are tuned. Results, also shown live in the Validation tab:

- **Duty and condensation match.** The model gives 4.84 MW (winter), 4.51 MW (14 Nov, 80 % latent) and 3.18 MW (summer), within 0.3 % of balance.py. The gas-duty routine reproduces all four scenarios.json cases within 1.5 % (balance.py uses CoolProp).
- **The cooler works at about 6 % of the clean model's UA.**
  - With the drawing geometry and the assumed fans, a clean A-1401 has UA ≈ 620 kW/K and would cool the gas almost to ambient.
  - The plant behaves like UA ≈ 38 kW/K.
  - The cleanliness factor UA_actual/UA_clean_model is 0.056 in winter 2024–25, 0.060 on 14 Nov and 0.053 in summer 2025, at measured air temperatures from −3 to 26 °C. The seasons agree within 13 %, so the loss belongs to the cooler, not the weather.
  - With the 2.4 m team-estimate fans the factors are 0.065–0.075. Fan size does not explain the gap.
- **Fitted fouling.** Fan scaling is held at 1.0: there is no airflow or fan-power measurement to fit it, and the clean design case is not binding. With 50 % of the fin gaps packed and fouling spread over all rows, the fitted R_f is 0.43 m²K/W (winter), 0.41 m²K/W (Nov) and 0.48 m²K/W (summer). Other blockage/R_f pairs fit equally well (0 % → 0.78, 35 % → 0.52, 70 % → 0.25 m²K/W). The plant points cannot separate them.
- **Bottom-row fouling alone cannot explain the data.** With 95 % of the bottom row blocked and R_f = 1, the clean rows above still cool the gas to ambient. The loss is spread over the bundle, or the airflow is much lower than assumed.
- **Caution.** To meet the design point (137 → 60 °C) at 38 °C air, the clean model needs only 6 % of its UA, about the same UA the plant shows now. Either the design carries a very large margin, or an assumption is optimistic: fan number, size and coverage, tube passes, or fin geometry. These documents would settle it:
  - fan datasheet: number, diameter, rpm, motor kW, pitch control;
  - API 661 data sheet: design duty, air flow, design air temperature, number of passes;
  - one measured fan current or air velocity.

## Assumptions (all marked "assumption" in the UI, with a tooltip)

| Assumption | Value |
|---|---|
| fin root diameter | 26 mm |
| fin density and thickness | 11 fpi, 0.40 mm |
| fin OD | 56.9 mm, back-calculated |
| tube passes | 6 |
| fans | 6 × Ø 4.2 m, 250 rpm (sized to API 661), ψ₀ = 0.065, φ₀ = 0.28 |
| fan efficiency | 0.70 |
| motor efficiency | 0.93 |
| plenum loss | K = 1.5 |
| condensate film h | 2000 W/m²K |
| syngas viscosity and conductivity | mixing rules |
| atmospheric pressure | 101.6 kPa |
| design ambient | 38 °C (1 % Jun–Aug exceedance at UATG, 2024–2026) |
| fan output | taken as fan speed |
| steam coil | one extra finned row |

Also simplified:

- ambient humidity is ignored;
- condensate is not sub-cooled after it forms (as in balance.py);
- air properties for the fan curve are taken at ambient.

## Sources

- Plant: P&ID and drawing data, model code GP10.5×3-6-226-4.0S-23.4/DR; hourly PI export (1400TIA050, 1400TICA0055 PV/MV, 1400PICA0017 MV, 1400FI010); D-1403 lab analysis; `tools/balance.py` → `data/scenarios.json`.
- Weather: hourly METAR, Atyrau airport (ICAO UATG), Iowa Environmental Mesonet ASOS/METAR archive, https://mesonet.agron.iastate.edu/request/download.phtml.
- API Standard 661, *Petroleum, petrochemical and natural gas industries — Air-cooled heat exchangers*: ≥ 40 % fan coverage, fan tip speed ≤ 60 m/s.
- Wagner, W., Pruss, A. (1993). International equations for the saturation properties of ordinary water substance. *J. Phys. Chem. Ref. Data* 22, 783.
- Watson, K. M. (1943). Thermodynamics of the liquid state. *Ind. Eng. Chem.* 35, 398.
- Briggs, D. E., Young, E. H. (1963). Convection heat transfer and pressure drop of air flowing across triangular pitch banks of finned tubes. *Chem. Eng. Prog. Symp. Ser.* 59(41), 1–10.
- Robinson, K. K., Briggs, D. E. (1966). Pressure drop of air flowing across triangular pitch banks of finned tubes. *Chem. Eng. Prog. Symp. Ser.* 62(64), 177–184.
- Schmidt, T. E. (1949). Heat transfer calculations for extended surfaces. *Refrigerating Engineering* 57, 351–357.
- Silver, L. (1947); Bell, K. J., Ghaly, M. A. (1973). An approximate generalized design method for multicomponent/partial condensers. *AIChE Symp. Ser.* 69(131), 72–79.
- Serth, R. W., Lestina, T. (2014). *Process Heat Transfer: Principles, Applications and Rules of Thumb*, 2nd ed., ch. 12 (air-cooled heat exchangers).
- API Standard 661, Air-cooled heat exchangers for general refinery services.
- Kröger, D. G. (2004). *Air-cooled Heat Exchangers and Cooling Towers*. PennWell.

Simplified engineering model for discussion, not a design or rating tool.
