#!/usr/bin/env python3
"""Extract Old World combat-relevant game data from the game's Reference XML
into web/data.js (a plain-script JS file usable from file:// and Node).

Source of truth: the game's own XML at
  ~/Library/Application Support/Steam/steamapps/common/Old World/Reference/XML/Infos
"""
import xml.etree.ElementTree as ET
import json, os, sys, re

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

# ---------- character traits -> the effects a general lends its unit ----------
# trait.xml: GeneralEffectUnit for any general, LeaderEffectUnit only when the
# general is the ruler (Character.getGeneralEffectUnits, Character.cs:10588-
# 10616). A ruler-general also carries LEADER_GENERAL_EFFECTUNIT
# (Character.cs:6508); the engine attaches it whenever a unit holds one of the
# `leader` effects, since those exist only because the ruler is aboard.
character_traits = {}
for z, e in entries(parse("trait.xml")):
    gen, lead = e.findtext("GeneralEffectUnit"), e.findtext("LeaderEffectUnit")
    if gen or lead:
        d = {}
        if gen:
            d["general"] = gen
        if lead:
            d["leader"] = lead
        character_traits[z] = d

# ---------- terrain targets -> vegetation ----------
# terrainTarget.xml names tile classes; abHideTerrainTarget on an effect
# (EFFECTUNIT_STEALTH: trees + jungle) says where its carrier hides. We
# resolve the indirection here so the engine can compare tile.vegetation
# directly (only vegetation-based targets are needed for hiding).
tt_veg = {}
for z, e in entries(parse("terrainTarget.xml")):
    v = strlist(e, "Vegetations")
    if v:
        tt_veg[z] = v

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
    ht = pairlist(e, "abHideTerrainTarget")
    if ht:
        veg = sorted({v for k, on in ht.items() if on for v in tt_veg.get(k, [])})
        if veg:
            d["hideVegetation"] = veg
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
             # the radius of water control an anchored ship projects
             # (Unit.waterControl, Unit.cs:3480 — base from the unit, plus
             # iWaterControlExtra from effects such as Lading). Never extracted,
             # so the engine hardcoded a radius of 1 while the game gives a
             # bireme 3, a trireme 4 and a dromon 5.
             "iWaterControl",
             "bIgnoreZOC"]
units = {}
for z, e in entries(parse("unit.xml")):
    s = scalars(e)
    d = {k: s[k] for k in KEEP_UNIT if k in s}
    traits = strlist(e, "aeUnitTrait") or []
    d["traits"] = traits
    # which nation may build it (unit.xml NationPrereq). Not a combat rule —
    # the editor groups the unique units by nation so an author can find them.
    nation = e.findtext("NationPrereq")
    if nation:
        d["nation"] = nation
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


# ---------- the game's own tooltip vocabulary ----------
# Effect display names and the help templates the game builds unit tooltips
# from, so our panels say what Old World says rather than paraphrasing it.
def clean(txt):
    if not txt:
        return ""
    t = txt
    # <true_1>A: {0_value}<false>{0_value} A<end>  ->  keep the labelled branch
    m = re.search(r"<true_\d+>(.*?)<false>(.*?)<end>", t)
    if m:
        t = m.group(1)
    t = re.sub(r"link\((?:CONCEPT_|UNITTRAIT_|YIELD_)?([A-Z_]+?)(?:,\d+)?\)",
               lambda m: m.group(1).replace("_", " ").lower(), t)
    t = re.sub(r"icon\([A-Z_]+\)\s*", "", t)
    t = t.replace("{gt}", ">")
    t = re.sub(r"\{\d_(value|turn|link|percent|effectList|unitTrait|yield|riverLink|tileLink|vegetation)\}", "{v}", t)
    t = re.sub(r"\{true_\d+:([^}]*)\}", r"\1", t)
    return re.sub(r"\s+", " ", t).strip()

effect_names, help_text = {}, {}
try:
    for z, e in entries(parse("text-effectUnit.xml")):
        en = e.findtext("en-US")
        if en and not z.endswith("_F"):
            effect_names[z.replace("TEXT_", "")] = en.split("~")[0].strip()
    for z, e in entries(parse("text-helptext.xml")):
        if z.startswith("TEXT_HELPTEXT_EFFECT_UNIT_HELP_"):
            help_text[z.replace("TEXT_HELPTEXT_EFFECT_UNIT_HELP_", "")] = clean(e.findtext("en-US"))
except Exception as ex:
    print("note: tooltip text unavailable:", ex)

data = {
    "globals": g,
    "traitEffects": trait_effect,
    "characterTraits": character_traits,
    "effects": effects,
    "promotions": promotions,
    "units": units,
    "terrain": terrain,
    "height": height,
    "vegetation": vegetation,
    "improvements": improvements,
    "effectNames": effect_names,
    "help": help_text,
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
