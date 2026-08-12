#!/usr/bin/env python3
"""Extract Old World combat-relevant game data from the game's Reference XML
into web/data.js (a plain-script JS file usable from file:// and Node).

Source of truth: the game's own XML at
  ~/Library/Application Support/Steam/steamapps/common/Old World/Reference/XML/Infos
"""
import xml.etree.ElementTree as ET
import json, os, sys

XML = os.path.expanduser(
    "~/Library/Application Support/Steam/steamapps/common/Old World/Reference/XML/Infos")
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "data.js")

def parse(name):
    return ET.parse(os.path.join(XML, name)).getroot()

def scalars(entry):
    """All iFoo / bFoo / zType scalar children."""
    d = {}
    for c in entry:
        tag, text = c.tag, (c.text or "").strip()
        if not text:
            continue
        if tag.startswith("i") and tag[1:2].isupper():
            d[tag] = int(text)
        elif tag.startswith("b") and tag[1:2].isupper():
            d[tag] = int(text)
    return d

def pairlist(entry, tag):
    """<aiFoo><Pair><zIndex>K</zIndex><iValue>V</iValue></Pair>...</aiFoo> -> {K:V}"""
    node = entry.find(tag)
    if node is None:
        return None
    d = {}
    for p in node.findall("Pair"):
        k = p.findtext("zIndex")
        v = p.findtext("iValue") or p.findtext("zValue") or p.findtext("bValue")
        if k is not None and v is not None:
            try:
                d[k] = int(v)
            except ValueError:
                d[k] = v
    return d or None

def strlist(entry, tag):
    node = entry.find(tag)
    if node is None:
        return None
    vals = [v.text for v in node.findall("zValue") if v.text]
    return vals or None

def entries(root):
    for e in root.iter("Entry"):
        z = e.findtext("zType")
        if z:
            yield z, e

# ---------- globals ----------
g = {}
for z, e in entries(parse("globalsInt.xml")):
    v = e.findtext("iValue")
    if v is not None:
        g[z] = int(v)

for z, e in entries(parse("globalsType.xml")):
    v = e.findtext("zValue")
    if v is not None:
        g[z] = v

# ---------- unit traits -> effect units ----------
trait_effect = {}
for z, e in entries(parse("unitTrait.xml")):
    eff = e.findtext("EffectUnit")
    if eff:
        trait_effect[z] = eff

# ---------- effect units (generic modifier bags) ----------
EFFECT_LISTS = [
    "abUnitTraitValid", "abUnitTraitInvalid",
    "aiHeightFromModifier", "aiTerrainFromModifier", "aiVegetationFromModifier",
    "aiImprovementToModifier", "aiMeleeToClearTerrainTargetModifier",
    "aiUnitTraitModifier", "aiUnitTraitModifierAttack",
    "aiUnitTraitModifierDefense", "aiUnitTraitModifierMelee",
    "aiOccurrenceFromModifier", "aiAttackPercent", "aiAttackValue",
]
effects = {}
for z, e in entries(parse("effectUnit.xml")):
    d = scalars(e)
    for lt in EFFECT_LISTS:
        pl = pairlist(e, lt)
        if pl:
            d[lt] = pl
    ap = e.find("AttackApplyEffectUnitTurns")
    if ap is not None:
        first, second = ap.findtext("First"), ap.findtext("Second")
        if first:
            d["attackApply"] = {"effect": first, "turns": int(second or 1)}
    tz = strlist(e, "aeUnitTraitZOC")
    if tz:
        d["aeUnitTraitZOC"] = tz
    imm = strlist(e, "aeEffectUnitImmune")
    if imm:
        d["aeEffectUnitImmune"] = imm
    ig = strlist(e, "aeIgnoreVegetationDefense")
    if ig:
        d["aeIgnoreVegetationDefense"] = ig
    if d:
        effects[z] = d

# ---------- promotions -> effect units ----------
promotions = {}
for z, e in entries(parse("promotion.xml")):
    eff = e.findtext("EffectUnit")
    if eff:
        promotions[z] = {"effect": eff, "prereq": e.findtext("PromotionPrereq") or None}

# ---------- units ----------
KEEP_UNIT = ["bRangeFlat", "iMovement", "iVision", "iFatigue", "iStrength", "iRangeMax",
             "iRangeMin", "iHPMax", "bMelee", "bZOC", "bBlocks", "bFortify",
             "bGeneral", "bRegular", "bWater", "bUnlimber", "bAnchor",
             "bIgnoreZOC"]
units = {}
for z, e in entries(parse("unit.xml")):
    s = scalars(e)
    d = {k: s[k] for k in KEEP_UNIT if k in s}
    traits = strlist(e, "aeUnitTrait") or []
    d["traits"] = traits
    innate = strlist(e, "aeEffectUnit") or []
    d["effects"] = [trait_effect[t] for t in traits if t in trait_effect] + innate
    fe = strlist(e, "aeFormations")
    if fe:
        d["formations"] = fe
    if "iStrength" in d and d["iStrength"] > 0:
        units[z] = d

# ---------- terrain / height / vegetation / improvements ----------
def simple_table(fname, keep):
    out = {}
    for z, e in entries(parse(fname)):
        s = scalars(e)
        out[z] = {k: s[k] for k in keep if k in s}
    return out

terrain = simple_table("terrain.xml", ["iMovementCost", "iUnitDamage", "bNoVegetation",
                                       "bRoadFree", "bUrban", "bWater"])
height = simple_table("height.xml", ["iMovementCost", "bElevation", "bRangedAttackBlock", "iRangeChange"])
improvements = simple_table("improvement.xml", ["iDefenseModifier", "iDefenseModifierFriendly",
                                               "bRoadFree"])

vegetation = {}
for z, e in entries(parse("vegetation.xml")):
    s = scalars(e)
    d = {k: s[k] for k in ["iMovementCost"] if k in s}
    dd = pairlist(e, "aiDefendEffectUnit")
    if dd:
        d["aiDefendEffectUnit"] = dd
    vegetation[z] = d

# water flags for terrain (isWater is terrain WATER)
terrain["TERRAIN_WATER"]["bWater"] = 1

data = {
    "globals": g,
    "traitEffects": trait_effect,
    "effects": effects,
    "promotions": promotions,
    "units": units,
    "terrain": terrain,
    "height": height,
    "vegetation": vegetation,
    "improvements": improvements,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("// GENERATED by tools/extract_data.py — do not edit.\n")
    f.write("// Source: Old World Reference XML (combat-relevant subset).\n")
    f.write("var OWDATA = ")
    json.dump(data, f, indent=1, sort_keys=True)
    f.write(";\nif (typeof module !== 'undefined') module.exports = OWDATA;\n")

print(f"wrote {os.path.abspath(OUT)}")
print(f"units={len(units)} effects={len(effects)} promotions={len(promotions)} globals={len(g)}")
