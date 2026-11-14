# A-1401 air cooler simulator

3D simulator of the A-1401 forced-draft syngas air cooler (hydrogen plant, Atyrau) for the AIChE Catalyst hackathon. It compares today's fouled cooler with two solutions, in four kinds of weather.

| Case | What changes in the model |
|---|---|
| **Normal** | Today: 50 % of fin gaps blocked, debris resistance R_f fitted to the plant outlet temperature (0.40–0.47 m²K/W). |
| **Solution 1**: hood + outlet screen + filters + spray | A hood over the top turns the air 90° with a round fillet to a side outlet, so rain, dust and insects cannot fall in. A tilted mesh screen closing the whole hood opening (instead of a cage round the whole cooler) and filter panels on the fan sides and in front of the fan keep debris out. The bundle is cleaned once and stays near-clean (3 % blocked, R_f 0.02). Water spray is fitted too (On by default; Auto sprays only when the fans alone cannot reach 65 °C). Costs: extra air-side pressure drop (hood turn + outlet, screen, filters). |
| **Solution 2**: standby cooler + spray + 137 °C | A second identical cooler; one runs while the other is cleaned, so the online unit is on average early in its fouling cycle (12 % blocked, R_f 0.08). Water spray pre-cools the inlet air toward the wet bulb (On, Auto or Off). E-1408 is restored, so the gas enters at 137 °C instead of ~167 °C. |
| **1 + 2** | Both together. |

Weather buttons: Winter (−3.4 °C), 14 Nov (7 °C), Summer mean (25.9 °C), Hot day (38 °C), from the Atyrau airport (UATG) records. The fan follows the plant controller TICA0055: the lowest output that reaches the 65 °C setpoint, else 100 %. The comparison table and the two charts (outlet temperature and fan power against air temperature) show every case at once. **Adjust** opens the sliders, including hood size and a water-spray switch (On / Auto / Off) for every case; the cube button shows the casing (bundle side plates and plenum) see-through or solid as built; the button at the top right, or the F key, makes the 3D view full screen.

No build step: plain HTML/CSS/JS, three.js and Chart.js from a CDN with local copies in `vendor/`. The second tab is the process overview of the cooling train. The sun/moon button switches between light and dark themes (default: the system setting).

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

**Plant data is not in the repository** (it may be confidential). The calibration targets below come from `tools/balance.py` run on the hourly export offline. `data/weather_uatg.csv` is public METAR data.

## Files

```
index.html            two tabs: simulator, process overview
css/style.css
js/model.js           all physics, the weather cases and the solutions (browser + node)
js/scene3d.js         three.js model: bundles, one fan, casing, hood, outlet screen, filters, spray jets, standby unit
js/simulator.js       case and weather buttons, readouts, comparison table, charts, full screen
js/overview.js        process flow diagram
data/scenarios.json   output of tools/balance.py (scenarios.js = same data for file://)
data/weather_uatg.csv hourly air temperature, Atyrau airport, Nov 2023 – Nov 2026
tools/balance.py      plant mass and energy balance
tools/weather.js      downloads the UATG METAR record, prints the case air temperatures
tests/model.test.js   18 tests (node:test)
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
- Fan: **one** forced-draft fan under the cooler (team information), Ø 7 m at 160 rpm (**assumption**, no datasheet; tip speed 59 m/s, face velocity 2.35 m/s clean). With one fan the fan-ring velocity head (K_plenum) dominates the system curve, so debris cuts the airflow less than it would with several fans; it hurts mainly by insulating the fins.
- Solution 1 adds to the system curve: hood = (0.3 + 1) · ½ρv_out² − ½ρv_face², where the opening is the slanted face from the bundle end up to the roof edge: √(H² + overhang²) × 18 m wide (default H 6 m, overhang 3 m: 6.7 m × 18 m). A low hood chokes the air: with the 7 m fan at 100 % and a 3 m overhang the airflow falls 7.6 % with a 1 m hood, 5.9 % at 2 m, 3.9 % at 3.2 m, 2.0 % at 5 m and 1.4 % at 6 m (without the overhang a 1 m hood would cost 40 %). Hot-air recirculation from the outlet back to the fan is not modelled; outlet screen = 0.5 · ½ρv_out² (a tilted mesh panel closing the whole hood opening, bottom included, not a cage round the cooler); filters = 80 Pa · (v_filter / 2.5 m/s)^1.5 with filter area 1.5 × face (all **assumptions**).
- Spray (any case): air reaching the fan T = T_amb − 0.7 (T_amb − T_wb), wet bulb from Stull (2011); off below 5 °C. Spray water = ṁ_air c_p ΔT / h_fg.
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

Only fouling is tuned (fan scaling held at 1). Results with one 7 m fan:

- **Duty and condensation match.** The model gives 4.84 MW (winter), 4.51 MW (14 Nov, 80 % latent) and 3.18 MW (summer), within 0.3 % of balance.py. The gas-duty routine reproduces all four scenarios.json cases within 1.5 % (balance.py uses CoolProp).
- **The cooler works at about 6–7 % of the clean model's UA.**
  - With the drawing geometry and the assumed fans, a clean A-1401 has UA ≈ 550 kW/K and would cool the gas almost to ambient.
  - The plant behaves like UA ≈ 39 kW/K.
  - The cleanliness factor UA_actual/UA_clean_model is 0.065 in winter 2024–25, 0.068 on 14 Nov and 0.060 in summer 2025, at measured air temperatures from −3 to 26 °C. The seasons agree within 13 %, so the loss belongs to the cooler, not the weather.
  - With one 4.2 m fan the factors are 0.087–0.103, with six 4.2 m fans 0.053–0.060. The fan size changes the number, not the conclusion.
- **Fitted fouling.** Fan scaling is held at 1.0: there is no airflow or fan-power measurement to fit it, and the clean design case is not binding. With 50 % of the fin gaps packed and fouling spread over all rows, the fitted R_f is 0.42 m²K/W (winter), 0.40 m²K/W (Nov) and 0.47 m²K/W (summer). Other blockage/R_f pairs fit equally well (0 % → 0.77, 35 % → 0.51, 70 % → 0.24 m²K/W). The plant points cannot separate them.
- **Bottom-row fouling alone cannot explain the data.** With 95 % of the bottom row blocked and R_f = 1, the clean rows above still cool the gas to ambient. The loss is spread over the bundle, or the airflow is much lower than assumed.
- **Caution.** To meet the design point (137 → 60 °C) at 38 °C air, the clean model needs only 7 % of its UA, about the same UA the plant shows now. Either the design carries a very large margin, or an assumption is optimistic: fan size and speed, tube passes, or fin geometry. These documents would settle it:
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
| fan | 1 × Ø 7 m, 160 rpm, ψ₀ = 0.065, φ₀ = 0.28 |
| hood, outlet screen, filters | 6 m tall, 3 m past the bundle end, K 0.3 + outlet head; K 0.5; 80 Pa at 2.5 m/s, 1.5 × face |
| fouling with solution 1 / online unit of solution 2 | 3 % blocked, R_f 0.02 / 12 % blocked, R_f 0.08 m²K/W |
| spray | 70 % effectiveness, off below 5 °C |
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
- Stull, R. (2011). Wet-bulb temperature from relative humidity and air temperature. *J. Appl. Meteor. Climatol.* 50, 2267–2269.
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
