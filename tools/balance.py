"""Mass & energy balance on A-1401 from plant data (hourly, 2023-11 .. 2026-11).

X = dry syngas to PSA (FI010), Y = flare via PV0017, Z = water condensed in A-1401.
Assumptions: gas saturated with water at A-1401 inlet (P&ID marks line as two-phase),
FI010 in Nm3/h (0 C, 1 atm) on dry basis, dry composition from D-1403 lab data.
"""
import json
import numpy as np
import pandas as pd
from CoolProp.CoolProp import PropsSI

d = pd.read_csv("full.tsv", sep="\t", parse_dates=["timestamp"]).set_index("timestamp")
d.index = d.index.tz_convert("Asia/Almaty")
c = {"Tin": "1400TIA050", "Tout": "1400TICA0055_pv", "fan": "1400TICA0055_mv",
     "pv17": "1400PICA0017_mv", "FI": "1400FI010"}
d = d.rename(columns={v: k for k, v in c.items()})[list(c)]

# flag frozen (stale) data: Tin, Tout, FI all unchanged vs previous hour for >= 24 h
same = (d[["Tin", "Tout", "FI"]].diff().abs().sum(axis=1) == 0)
run = same.groupby((~same).cumsum()).cumsum()
frozen_start = d.index[(run >= 24).values][0] if (run >= 24).any() else None
valid = d.copy()
if frozen_start is not None:
    first = frozen_start - pd.Timedelta(hours=23)
    valid = d[(d.index < first) | (d.index == d.index[-1])]
# running plant only
valid = valid[(valid.FI > 10000) & (valid.Tin > 120) & valid.Tout.notna()]

# dry gas properties (lab, D-1403, Jan-Mar 2026 average)
y = {"H2": .745, "CO2": .176, "CH4": .048, "CO": .022, "N2": .009}
MW = {"H2": 2.016, "CO2": 44.01, "CH4": 16.04, "CO": 28.01, "N2": 28.01}
cp = {"H2": 29.1, "CO2": 39.0, "CH4": 38.0, "CO": 29.2, "N2": 29.1}  # kJ/kmol/K ~110 C
MWd = sum(y[k] * MW[k] for k in y)
cpd = sum(y[k] * cp[k] for k in y)
P_in, P_out = (26.90 * 0.0980665 + 0.101325) * 1e6, (26.55 * 0.0980665 + 0.101325) * 1e6


def psat(T):
    return PropsSI("P", "T", T + 273.15, "Q", 0, "Water")


def nw(T, P, ndry):
    p = psat(T)
    return ndry * p / (P - p)  # kmol/h water vapour at saturation


def a1401(Tin, Tout, FI, n=200):
    ndry = FI / 22.414                     # kmol/h
    X = ndry * MWd                         # kg/h dry gas
    Ts = np.linspace(Tin, Tout, n)
    Ps = np.linspace(P_in, P_out, n)
    w = np.array([nw(T, P, ndry) for T, P in zip(Ts, Ps)])
    hfg = np.array([PropsSI("H", "T", T + 273.15, "Q", 1, "Water") - PropsSI("H", "T", T + 273.15, "Q", 0, "Water") for T in Ts])
    dn = -np.diff(w)                       # kmol/h condensed per step
    Qlat = np.sum(dn * 18.015 * 0.5 * (hfg[1:] + hfg[:-1])) / 3.6e9  # MW
    Qdry = ndry * cpd * (Tin - Tout) / 3600 / 1000                    # MW
    Qvap = np.sum(0.5 * (w[1:] + w[:-1]) * 34.0 * (-np.diff(Ts))) / 3600 / 1000
    Z = (w[0] - w[-1]) * 18.015            # kg/h condensed in A-1401
    w38 = nw(38, P_out, ndry)
    return dict(FI=FI, X=X, Z=Z, vap_in=w[0] * 18.015, vap_out=w[-1] * 18.015,
                Z_downstream=(w[-1] - w38) * 18.015, Q=Qlat + Qdry + Qvap,
                Qlat=Qlat, Qsens=Qdry + Qvap, Tin=Tin, Tout=Tout)


def scen(name, sl, note):
    s = valid.loc[sl] if isinstance(sl, slice) else valid.iloc[[-1]]
    r = a1401(s.Tin.mean(), s.Tout.mean(), s.FI.mean())
    r.update(name=name, note=note, fan=s.fan.mean(), fan100=float((s.fan >= 99).mean() * 100),
             pv17=s.pv17.mean(), pv17_open=float((s.pv17 > 0.5).mean() * 100), hours=len(s))
    return r


S = [
    scen("Winter", slice("2024-12-01", "2025-02-28"), "Dec 2024 - Feb 2025 average"),
    scen("Summer", slice("2025-06-01", "2025-08-31"), "Jun - Aug 2025 average"),
    scen("Now", None, "14 Nov 2026, 14:00 snapshot"),
]
now = S[-1]
des = a1401(137.0, 60.0, now["FI"])
des.update(name="Design temps", note="P&ID design 137 -> 60 C at today's flow", fan=None,
           fan100=None, pv17=0.0, pv17_open=0.0, hours=0)
S.insert(0, des)

print(f"dry MW {MWd:.2f} kg/kmol, cp {cpd:.1f} kJ/kmol/K, valid rows {len(valid)}, frozen from {frozen_start}")
for r in S:
    print(f"{r['name']:13s} Tin {r['Tin']:.1f} Tout {r['Tout']:.1f} FI {r['FI']:.0f} X {r['X']:.0f} kg/h "
          f"Z {r['Z']:.0f} kg/h Zdown {r['Z_downstream']:.0f} Q {r['Q']:.2f} MW (lat {r['Qlat']:.2f}) "
          f"fan {r['fan']} fan100 {r['fan100']} pv17 {r['pv17']:.3f} open% {r['pv17_open']:.1f}")
json.dump(S, open("scenarios.json", "w"), indent=1, default=float)
