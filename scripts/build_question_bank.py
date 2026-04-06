from __future__ import annotations

import argparse
import json
import re
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import fitz
import numpy as np
import requests
from rapidocr_onnxruntime import RapidOCR


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = Path(r"C:\Users\HP\Downloads\KEAM_PYQ_All.pdf")
MAPPING_PATH = ROOT / "index_mapping.json"
OUTPUT_DIR = ROOT / "data"
CACHE_DIR = ROOT / ".cache"
PAGE_CACHE_PATH = CACHE_DIR / "page_texts.json"
QUESTION_BANK_PATH = OUTPUT_DIR / "question_bank.json"
QUESTION_BANK_MD_PATH = OUTPUT_DIR / "question_bank.md"
QUESTION_BANK_REPORT_PATH = OUTPUT_DIR / "question_bank_report.json"
CACHE_VERSION = 2


QUESTION_TOTAL_HINTS = {
    "pharmacy": 75,
    "paper i physics & chemistry": 120,
    "paper-i physics & chemistry": 120,
    "maths question paper": 120,
    "full questions": 120,
}

INSTRUCTION_PREFIXES = (
    "this question paper comprises",
    "the paper is divided",
    "there are",
    "for each correct response",
    "please ensure",
    "please fill",
    "negative marking",
    "read the following instructions",
    "instructions to candidates",
    "the keam 2025",
)

NOISE_PATTERNS = (
    "space for rough work",
    "spaceforroughwork",
    "spacefor rough work",
    "visit https://scienceinstitute.in",
    "www.scienceinstitute.in",
    "course details",
    "repeaters",
    "admission started",
    "hostel facility",
    "online classes",
)

FOOTER_PATTERNS = (
    "phy-chy-i-",
    "phy-chy-l-",
    "maths-",
    "[p.t.o.",
    "[p.t.o",
)

PAGE_MARKER_RE = re.compile(r"^\[\[PAGE\s+(\d+)\]\]$")
INLINE_Q_RE = re.compile(r"^\s*(\d{1,3})[.)]\s*(.+)$")
SPACE_Q_RE = re.compile(r"^\s*(\d{1,3})\s+(.+)$")
BARE_Q_RE = re.compile(r"^\s*(\d{1,3})[.)]?\s*$")
HEADER_DATE_RE = re.compile(
    r"(?:(\d{1,2})[-/](\d{1,2})[-/](\d{2,4}))|"
    r"(?:(\d{4})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}))|"
    r"(?:(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4}))",
    re.IGNORECASE,
)
VERSION_RE = re.compile(r"\b([AB]\d)\b")
OPTION_MARKER_RE = re.compile(r"(?<![A-Za-z0-9])(?:\(\s*([A-E])\s*\)|([A-E])\s*\)|([A-E])\s*:)", re.IGNORECASE)
ANSWER_RE = re.compile(r"Correct Answer\s*:?\s*(?:Option\s*)?([A-E]|DEL)\b", re.IGNORECASE)

MONTH_LOOKUP = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

DATE_LABEL_OVERRIDES = {
    1: ("24 April 2025", 2025),
    25: ("24 April 2025", 2025),
    49: ("25 April 2025", 2025),
    69: ("27 April 2025", 2025),
    89: ("26 April 2025", 2025),
    105: ("23 April 2025", 2025),
    126: ("28 April 2025", 2025),
    133: ("29 April 2025", 2025),
    150: ("10 June 2024", 2024),
    167: ("5 June 2024", 2024),
    203: ("6 June 2024", 2024),
    241: ("7 June 2024", 2024),
    280: ("8 June 2024", 2024),
    316: ("9 June 2024", 2024),
    353: ("17 May 2023", 2023),
    374: ("2022 Paper I Physics & Chemistry", 2022),
    404: ("2021 Maths Paper II", 2021),
    435: ("2021 Physics & Chemistry Paper I", 2021),
}

EXAM_SOURCE_OVERRIDES = {
    49: {
        "kind": "official_pdf",
        "url": "https://www.cee.kerala.gov.in/keam2025/list/anskey/Final_Engg2_25042025.pdf",
        "answer_source_label": "CEE Kerala final answer key",
    },
    69: {
        "kind": "official_pdf",
        "url": "https://www.cee.kerala.gov.in/keam2025/list/anskey/Final_Engg4_27042025.pdf",
        "answer_source_label": "CEE Kerala final answer key",
    },
    89: {
        "kind": "official_pdf",
        "url": "https://www.cee.kerala.gov.in/keam2025/list/anskey/Final_Engg3_26042025.pdf",
        "answer_source_label": "CEE Kerala final answer key",
    },
    105: {
        "kind": "official_pdf",
        "url": "https://www.cee.kerala.gov.in/keam2025/list/anskey/Final_Engg1_23042025.pdf",
        "answer_source_label": "CEE Kerala final answer key",
    },
    126: {
        "kind": "official_pdf",
        "url": "https://www.cee.kerala.gov.in/keam2025/list/anskey/Final_Engg5_28042025.pdf",
        "answer_source_label": "CEE Kerala final answer key",
    },
    133: {
        "kind": "official_pdf",
        "url": "https://www.cee.kerala.gov.in/keam2025/list/anskey/Final_Bpharm3_29042025.pdf",
        "answer_source_label": "CEE Kerala final answer key",
    },
}

ANSWER_KEY_SOURCES = {
    "17-may-2023": {
        "label": "CEE Kerala answer key",
        "url": "https://www.cee.kerala.gov.in/keam2023/list/anskey/Version%20A1.pdf",
    },
    "2022-paper-i-physics-chemistry": {
        "label": "CEE Kerala answer key",
        "url": "https://www.cee.kerala.gov.in/keam2022/pdf/key_p1.pdf",
    },
    "2021-maths-paper-ii": {
        "label": "Bundled PDF / Science Institute source",
        "url": "https://scienceinstitute.in/entranceview/37",
    },
    "2021-physics-chemistry-paper-i": {
        "label": "Bundled PDF / Science Institute source",
        "url": "https://scienceinstitute.in/entranceview/36",
    },
}

CHAPTER_RULES = [
    ("Mathematics", "Calculus", "Differentiation", [r"\blim\b", r"\bderivative\b", r"\bdifferentiat", r"f['′]\(x\)", r"\bdy/dx\b"]),
    ("Mathematics", "Calculus", "Integration", [r"\bintegral\b", r"\b∫\b", r"\barea under", r"\bdefinite integral\b"]),
    ("Mathematics", "Trigonometry", "Trigonometric identities", [r"\bsin\b", r"\bcos\b", r"\btan\b", r"\bcot", r"\bcosec", r"\bsec"]),
    ("Mathematics", "Complex Numbers", "Complex number operations", [r"\bcomplex\b", r"\bargand\b", r"\bi\^", r"\bmodulus\b", r"\b\|z\|"]),
    ("Mathematics", "Matrices and Determinants", "Matrices or determinants", [r"\bmatrix\b", r"\bdeterminant\b", r"\badj\(a\)", r"\binverse matrix\b"]),
    ("Mathematics", "Vectors and 3D Geometry", "Vectors", [r"\bvector\b", r"\b\vec", r"\bdot product\b", r"\bcross product\b", r"\bdirection cosines\b"]),
    ("Mathematics", "Coordinate Geometry", "Straight lines and conics", [r"\bellipse\b", r"\bparabola\b", r"\bhyperbola\b", r"\bcircle\b", r"\blatus rectum\b", r"\bslope\b"]),
    ("Mathematics", "Probability", "Probability and random variables", [r"\bprobability\b", r"\bbinomial\b", r"\bmean\b", r"\bvariance\b", r"\bstandard deviation\b"]),
    ("Mathematics", "Sets and Relations", "Sets or relations", [r"\brelation\b", r"\bonto\b", r"\binto\b", r"\binjective\b", r"\bsurjective\b", r"\bset\b", r"\bsubset"]),
    ("Physics", "Electrostatics", "Electric charges and fields", [r"\belectric field\b", r"\belectric flux\b", r"\belectrostatic", r"\bcoulomb", r"\bcapacitor\b", r"\bcapacitance\b", r"\bdielectric\b", r"\bdipole\b", r"\bpotential difference\b", r"\bgauss\b", r"\bpolarization\b"]),
    ("Physics", "Current Electricity", "Current, resistance, drift and circuits", [r"\bcurrent\b", r"\bresistance\b", r"\bresistivity\b", r"\bohm\b", r"\bdrift velocity\b", r"\bmobility\b", r"\bwheatstone\b", r"\bkirchhoff\b", r"\bconductivity\b"]),
    ("Physics", "Magnetism", "Moving charges and magnetism", [r"\bmagnetic field\b", r"\bmagnetic force\b", r"\bcyclotron\b", r"\blorentz\b", r"\bmagnetic moment\b", r"\bbiot", r"\bampere", r"\bflux linked\b"]),
    ("Physics", "Electromagnetic Induction and AC", "Inductance, induced emf, alternating current", [r"\binduced emf\b", r"\bmutual induction\b", r"\bself induction\b", r"\binductance\b", r"\breactance\b", r"\bimpedance\b", r"\btransformer\b", r"\bac circuit\b"]),
    ("Physics", "Optics", "Ray or wave optics", [r"\blens\b", r"\bmirror\b", r"\bprism\b", r"\bpolarized\b", r"\binterference\b", r"\bdiffraction\b", r"\bfocal length\b", r"\bmicroscope\b", r"\btelescope\b"]),
    ("Physics", "Semiconductors", "Semiconductor electronics", [r"\bp-n junction\b", r"\bdiode\b", r"\btransistor\b", r"\bsemiconductor\b", r"\bzener\b", r"\bdepletion region\b", r"\blogic gate\b"]),
    ("Physics", "Atoms and Nuclei", "Atomic or nuclear physics", [r"\bhalf-life\b", r"\bradioactive\b", r"\bnucleus\b", r"\bbinding energy\b", r"\bmass defect\b", r"\bbohr\b", r"\bhydrogen spectrum\b"]),
    ("Physics", "Dual Nature and EM Waves", "Dual nature or electromagnetic waves", [r"\bde broglie\b", r"\bphotoelectric\b", r"\belectromagnetic wave\b", r"\bfrequency of.*wave\b"]),
    ("Physics", "Kinematics", "Motion in one or two dimensions", [r"\bvelocity\b", r"\bacceleration\b", r"\bdisplacement\b", r"\bprojectile\b", r"\bstopping distance\b", r"\baverage speed\b"]),
    ("Physics", "Laws of Motion", "Force, friction, momentum and impulse", [r"\bforce\b", r"\bfriction\b", r"\bimpulse\b", r"\bmomentum\b", r"\bnewton"]),
    ("Physics", "Work, Energy and Power", "Energy and work", [r"\bkinetic energy\b", r"\bpotential energy\b", r"\bpower\b", r"\bwork done\b", r"\bspring constant\b"]),
    ("Physics", "Rotational Motion", "Torque, angular motion and moment of inertia", [r"\btorque\b", r"\bangular velocity\b", r"\bangular momentum\b", r"\bmoment of inertia\b", r"\brolling\b"]),
    ("Physics", "Gravitation", "Gravity and satellites", [r"\bsatellite\b", r"\bgravitation\b", r"\bescape velocity\b", r"\borbital\b", r"\bearth\b"]),
    ("Physics", "Thermodynamics", "Heat, gases and thermodynamics", [r"\bheat engine\b", r"\bcarnot\b", r"\bideal gas\b", r"\binternal energy\b", r"\bthermodynamic\b", r"\btemperature\b", r"\bentropy\b"]),
    ("Physics", "Oscillations and Waves", "SHM and waves", [r"\bshm\b", r"\bsimple harmonic\b", r"\bwave\b", r"\bwavelength\b", r"\bfrequency\b", r"\bopen pipe\b", r"\bclosed pipe\b", r"\bresonance\b"]),
    ("Physics", "Mechanical Properties of Matter", "Elasticity and fluids", [r"\byoung", r"\bshear modulus\b", r"\bstress\b", r"\bstrain\b", r"\bviscosity\b", r"\bsurface tension\b"]),
    ("Physics", "Units and Measurements", "Dimensions and significant figures", [r"\bdimensional\b", r"\bsignificant figures\b", r"\bunits?\b", r"\berror\b"]),
    ("Chemistry", "Chemical Bonding", "Bonding, geometry and dipole moment", [r"\bdipole moment\b", r"\boctet\b", r"\bhybrid", r"\bgeometry\b", r"\bshape of\b", r"\bvalence shell\b"]),
    ("Chemistry", "Atomic Structure", "Atoms, orbitals and quantum ideas", [r"\borbital\b", r"\bquantum\b", r"\bsubshell\b", r"\belectronic configuration\b"]),
    ("Chemistry", "Periodic Table", "Periodic properties", [r"\bionization\b", r"\belectron affinity\b", r"\belectronegativity\b", r"\batomic radius\b", r"\bperiodic"]),
    ("Chemistry", "Solutions", "Solutions and colligative properties", [r"\bmole fraction\b", r"\bmolality\b", r"\bhenry", r"\bboiling point\b", r"\bfreezing point\b", r"\bosmotic\b"]),
    ("Chemistry", "Thermodynamics and Equilibrium", "Chemical thermodynamics or equilibrium", [r"\bequilibrium\b", r"\ble chatelier\b", r"\benthalpy\b", r"\bentropy\b", r"\bgibbs\b", r"\bkp\b", r"\bkc\b"]),
    ("Chemistry", "Electrochemistry", "Electrolysis and electrochemical cells", [r"\belectrolysis\b", r"\belectrochemical\b", r"\belectrode potential\b", r"\bfaraday\b", r"\bcell reaction\b"]),
    ("Chemistry", "Chemical Kinetics", "Rate laws and reaction order", [r"\brate law\b", r"\bactivation energy\b", r"\border of reaction\b", r"\brate constant\b"]),
    ("Chemistry", "Coordination Compounds", "Complexes and ligands", [r"\bligand\b", r"\bcoordination\b", r"\bcomplex\b", r"\bchelating\b", r"\bcoordination number\b"]),
    ("Chemistry", "d and f Block Elements", "Transition, lanthanoid or actinoid chemistry", [r"\blanthanoid\b", r"\bactinoid\b", r"\btransition metal\b", r"\bd-block\b", r"\bf-block\b"]),
    ("Chemistry", "Hydrocarbons", "Hydrocarbons and aromatic chemistry", [r"\bbenzene\b", r"\baromatic\b", r"\balkane\b", r"\balkene\b", r"\balkyne\b", r"\betard\b", r"\bfriedel\b"]),
    ("Chemistry", "Haloalkanes and Haloarenes", "Halogen derivatives", [r"\bhaloalk", r"\bhaloar", r"\bchlorobenzene\b", r"\bsandmeyer\b", r"\bfinkelstein\b", r"\bswarts\b"]),
    ("Chemistry", "Alcohols, Phenols and Ethers", "Alcohols, phenols or ethers", [r"\balcohol\b", r"\bphenol\b", r"\bether\b", r"\breimer\b", r"\bwilliamson\b"]),
    ("Chemistry", "Aldehydes, Ketones and Carboxylic Acids", "Carbonyl compounds and acids", [r"\baldehyde\b", r"\bketone\b", r"\bcarboxylic\b", r"\bfehling\b", r"\btollen\b", r"\bacetone\b", r"\bacetophenone\b"]),
    ("Chemistry", "Amines and Diazonium Salts", "Amines or diazonium chemistry", [r"\bamine\b", r"\bdiazonium\b", r"\baniline\b"]),
    ("Chemistry", "Biomolecules", "Biomolecules and polymers", [r"\bcarbohydrate\b", r"\bprotein\b", r"\bvitamin\b", r"\bbiomolecule\b", r"\bpolymer\b"]),
    ("Chemistry", "Organic Chemistry General", "General organic chemistry", [r"\biupac\b", r"\bisomer\b", r"\bnucleophilic\b", r"\belectrophilic\b", r"\bgrignard\b"]),
]

CHAPTER_NOTES = {
    "Electrostatics": {
        "concepts": [
            "Coulomb's law and inverse-square dependence",
            "Electric field, potential, and potential difference",
            "Capacitance, dielectric effect, and series-parallel combinations",
            "Electric dipole torque and Gauss's law",
        ],
        "equations": [
            r"F = \frac{1}{4\pi\varepsilon_0}\frac{q_1 q_2}{r^2}",
            r"V = \frac{W}{q}",
            r"C = \frac{Q}{V}",
            r"\tau = pE\sin\theta",
            r"\Phi_E = \frac{q_{\mathrm{enc}}}{\varepsilon_0}",
        ],
    },
    "Current Electricity": {
        "concepts": [
            "Ohm's law and resistance relations",
            "Drift velocity and mobility",
            "Series-parallel circuit reduction",
        ],
        "equations": [
            r"V = IR",
            r"R = \rho \frac{L}{A}",
            r"I = nAe v_d",
            r"\mu = \frac{v_d}{E}",
        ],
    },
    "Magnetism": {
        "concepts": [
            "Magnetic force on moving charge and current element",
            "Right-hand rule and circular motion in magnetic field",
            "Time period in magnetic field depends on charge-to-mass ratio",
        ],
        "equations": [
            r"F = qvB\sin\theta",
            r"F = BIL\sin\theta",
            r"T = \frac{2\pi m}{qB}",
        ],
    },
    "Optics": {
        "concepts": [
            "Lens and mirror sign conventions",
            "Interference and fringe-width relations",
            "Refraction and refractive index",
        ],
        "equations": [
            r"\frac{1}{f} = \frac{1}{v} - \frac{1}{u}",
            r"\beta = \frac{\lambda D}{d}",
            r"n = \frac{c}{v}",
        ],
    },
    "Kinematics": {
        "concepts": [
            "Equations of uniformly accelerated motion",
            "Projectile motion and component analysis",
            "Velocity-time and displacement-time interpretation",
        ],
        "equations": [
            r"v = u + at",
            r"s = ut + \frac{1}{2}at^2",
            r"v^2 = u^2 + 2as",
            r"R = \frac{u^2\sin 2\theta}{g}",
        ],
    },
    "Work, Energy and Power": {
        "concepts": [
            "Work-energy theorem",
            "Potential energy in gravitational and spring systems",
            "Conservation of mechanical energy",
        ],
        "equations": [
            r"W = \Delta K",
            r"U = mgh",
            r"U = -\frac{GMm}{r}",
            r"P = \frac{W}{t}",
        ],
    },
    "Rotational Motion": {
        "concepts": [
            "Torque as rotational analogue of force",
            "Moment of inertia and angular acceleration",
            "Rolling motion",
        ],
        "equations": [
            r"\tau = rF\sin\theta",
            r"\tau = I\alpha",
            r"L = I\omega",
        ],
    },
    "Trigonometry": {
        "concepts": [
            "Standard trigonometric identities",
            "Angle transformations and inverse trigonometric forms",
        ],
        "equations": [
            r"\sin^2\theta + \cos^2\theta = 1",
            r"1 + \tan^2\theta = \sec^2\theta",
            r"\sin 2\theta = 2\sin\theta\cos\theta",
        ],
    },
    "Calculus": {
        "concepts": [
            "Limit evaluation using identities and algebraic simplification",
            "Derivative rules and application of monotonicity",
            "Definite integral as area or net change",
        ],
        "equations": [
            r"\lim_{x\to 0}\frac{\sin x}{x} = 1",
            r"\frac{d}{dx}(x^n) = nx^{n-1}",
            r"\int x^n\,dx = \frac{x^{n+1}}{n+1} + C",
        ],
    },
    "Complex Numbers": {
        "concepts": [
            "Algebra of complex numbers and conjugates",
            "Modulus, argument, and geometric interpretation",
        ],
        "equations": [
            r"z = a + ib",
            r"|z| = \sqrt{a^2+b^2}",
            r"z\bar{z} = |z|^2",
        ],
    },
    "Matrices and Determinants": {
        "concepts": [
            "Determinant evaluation and invertibility",
            "Matrix multiplication compatibility and properties",
        ],
        "equations": [
            r"\det(AB) = \det(A)\det(B)",
            r"A^{-1} = \frac{\operatorname{adj}(A)}{\det(A)}",
        ],
    },
    "Coordinate Geometry": {
        "concepts": [
            "Locus interpretation of conic equations",
            "Slope, intercepts, and distance relations",
        ],
        "equations": [
            r"(x-h)^2 + (y-k)^2 = r^2",
            r"y = mx + c",
        ],
    },
    "Probability": {
        "concepts": [
            "Counting before probability",
            "Independent events and conditional probability",
            "Expectation and variance for standard distributions",
        ],
        "equations": [
            r"P(A\cup B) = P(A) + P(B) - P(A\cap B)",
            r"P(A|B) = \frac{P(A\cap B)}{P(B)}",
        ],
    },
    "Chemical Bonding": {
        "concepts": [
            "VSEPR geometry and hybridisation",
            "Dipole moment as geometry-dependent vector sum",
            "Octet rule and resonance effects",
        ],
        "equations": [
            r"\mu = q \times r",
        ],
    },
    "Atomic Structure": {
        "concepts": [
            "Quantum numbers and orbital description",
            "Electronic configuration and energy ordering",
        ],
        "equations": [
            r"E_n = -\frac{13.6}{n^2}\,\mathrm{eV}",
            r"\lambda = \frac{h}{mv}",
        ],
    },
    "Solutions": {
        "concepts": [
            "Concentration terms and dilution",
            "Colligative properties depend on number of solute particles",
        ],
        "equations": [
            r"\text{Mass \%} = \frac{\text{mass of solute}}{\text{mass of solution}}\times 100",
            r"\Delta T_b = iK_b m",
            r"\Delta T_f = iK_f m",
        ],
    },
    "Thermodynamics and Equilibrium": {
        "concepts": [
            "Enthalpy, entropy, and spontaneity",
            "Reaction quotient and equilibrium constant",
        ],
        "equations": [
            r"\Delta G = \Delta H - T\Delta S",
            r"K_c = \frac{\text{products}^{\nu}}{\text{reactants}^{\nu}}",
        ],
    },
    "Electrochemistry": {
        "concepts": [
            "Cell potential and electron flow",
            "Faraday laws of electrolysis",
        ],
        "equations": [
            r"E_{\text{cell}} = E^\circ_{\text{cathode}} - E^\circ_{\text{anode}}",
            r"Q = It",
        ],
    },
    "Chemical Kinetics": {
        "concepts": [
            "Rate law and order of reaction",
            "Integrated rate equations",
        ],
        "equations": [
            r"\text{Rate} = k[A]^m[B]^n",
            r"t_{1/2} = \frac{0.693}{k}\text{ for first order}",
        ],
    },
    "Coordination Compounds": {
        "concepts": [
            "Ligands, coordination number, and geometry",
            "Electrolytic nature from ionisation behavior",
        ],
        "equations": [],
    },
    "Hydrocarbons": {
        "concepts": [
            "Aromaticity and Huckel rule",
            "Stability and reactivity of hydrocarbons",
        ],
        "equations": [
            r"\text{Aromatic if }(4n+2)\pi\text{ electrons}",
        ],
    },
}

ANSWER_KEY_2023_A1 = """
1 C 31 B 61 C 91 B
2 A 32 C 62 A 92 D
3 B 33 A 63 C 93 A
4 B 34 E 64 A 94 B
5 B 35 C 65 A 95 D
6 B 36 E 66 B 96 D
7 C 37 A 67 A 97 B
8 E 38 B 68 D 98 C
9 A 39 D 69 D 99 B
10 DEL 40 D 70 D 100 C
11 A 41 E 71 C 101 DEL
12 E 42 C 72 D 102 B
13 E 43 C 73 B 103 E
14 D 44 B 74 C 104 A
15 C 45 D 75 E 105 E
16 B 46 A 76 D 106 C
17 D 47 C 77 E 107 B
18 C 48 B 78 B 108 E
19 B 49 B 79 D 109 C
20 E 50 A 80 B 110 DEL
21 C 51 E 81 A 111 B
22 E 52 E 82 E 112 D
23 D 53 B 83 E 113 D
24 E 54 A 84 A 114 B
25 A 55 E 85 B 115 D
26 C 56 C 86 A 116 E
27 E 57 D 87 D 117 E
28 D 58 C 88 D 118 D
29 E 59 D 89 E 119 C
30 A 60 A 90 A 120 B
""".strip()


@dataclass
class PageText:
    page: int
    source: str
    text: str
    ocr_text: str | None = None
    similarity: float | None = None


def normalize_whitespace(text: str) -> str:
    text = text.replace("\xa0", " ").replace("\u200b", "").replace("\uf0ad", "")
    return re.sub(r"[ \t]+", " ", text).strip()


def normalize_compare(text: str) -> str:
    cleaned = text.lower()
    cleaned = cleaned.replace("\n", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^a-z0-9]+", "", cleaned)
    return cleaned


def similarity_ratio(a: str, b: str) -> float:
    a_norm = normalize_compare(a)
    b_norm = normalize_compare(b)
    if not a_norm and not b_norm:
        return 1.0
    if not a_norm or not b_norm:
        return 0.0
    overlap = sum(1 for x, y in zip(a_norm, b_norm) if x == y)
    return overlap / max(len(a_norm), len(b_norm))


def infer_question_total(exam_info: str) -> int:
    lowered = exam_info.lower()
    for needle, total in QUESTION_TOTAL_HINTS.items():
        if needle in lowered:
            return total
    return 150


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def parse_exam_date(exam_info: str, header_text: str, start_page: int) -> tuple[str | None, int | None]:
    override = DATE_LABEL_OVERRIDES.get(start_page)
    if override:
        return override

    joined = f"{exam_info}\n{header_text}"
    match = HEADER_DATE_RE.search(joined)
    if not match:
        return None, None

    if match.group(1):
        day = int(match.group(1))
        month = int(match.group(2))
        year = int(match.group(3))
        if year < 100:
            year += 2000
    elif match.group(4):
        year = int(match.group(4))
        month = MONTH_LOOKUP[match.group(5).lower()]
        day = int(match.group(6))
    else:
        day = int(match.group(7))
        month = MONTH_LOOKUP[match.group(8).lower()]
        year = int(match.group(9))

    month_name = list(MONTH_LOOKUP.keys())[month - 1].title()
    return f"{day} {month_name} {year}", year


def extract_shift(exam_info: str) -> str | None:
    match = re.search(r"shift\s*(\d+)", exam_info, re.IGNORECASE)
    if match:
        return f"Shift {match.group(1)}"
    return None


def extract_version_code(text: str) -> str | None:
    match = VERSION_RE.search(text)
    if match:
        return match.group(1)
    return None


def detect_ocr_needed(text_layer: str, page_no: int) -> bool:
    stripped = text_layer.strip()
    if len(stripped) < 80:
        return True
    if 374 <= page_no <= 464:
        return True
    return False


def ocr_page(pdf: fitz.Document, page_no: int, ocr: RapidOCR) -> str:
    page = pdf[page_no - 1]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    result, _ = ocr(img)
    if not result:
        return ""
    return "\n".join(item[1] for item in result)


def score_text_quality(text: str) -> int:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    question_markers = sum(bool(parse_question_candidate(line)) for line in lines)
    option_markers = sum(1 for line in lines if line.startswith(("A", "(A", "B", "(B", "C", "(C", "D", "(D", "E", "(E")))
    penalties = sum(1 for line in lines if "science institute" in line.lower() or "rough work" in line.lower())
    return question_markers * 4 + option_markers - penalties


def choose_page_text(page_no: int, text_layer: str, ocr_text: str | None) -> tuple[str, str]:
    if not ocr_text:
        return "text_layer", text_layer
    if 374 <= page_no <= 464:
        return "ocr", ocr_text

    text_score = score_text_quality(text_layer)
    ocr_score = score_text_quality(ocr_text)
    if ocr_score > text_score + 1:
        return "ocr", ocr_text
    return "text_layer", text_layer


def load_page_cache() -> dict[str, dict]:
    if not PAGE_CACHE_PATH.exists():
        return {}
    payload = json.loads(PAGE_CACHE_PATH.read_text(encoding="utf-8"))
    if payload.get("version") != CACHE_VERSION:
        return {}
    return payload.get("pages", {})


def save_page_cache(cache: dict[str, dict]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": CACHE_VERSION,
        "pages": cache,
    }
    PAGE_CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def clean_page_text(text: str) -> str:
    cleaned_lines: list[str] = []

    for raw in text.splitlines():
        line = normalize_whitespace(raw)
        lowered = line.lower()
        if not line:
            continue
        if any(token in lowered for token in NOISE_PATTERNS):
            break
        if any(token in lowered for token in FOOTER_PATTERNS):
            continue
        if lowered in {str(i) for i in range(1, 33)}:
            continue
        if lowered.startswith("science institute") or lowered.startswith("the premier institute"):
            continue
        if lowered.startswith("warning") and "question" not in lowered:
            continue
        if lowered.startswith("printed pages"):
            continue
        if lowered.startswith("name of the candidate"):
            continue
        if lowered.startswith("roll number"):
            continue
        if lowered.startswith("serial number"):
            continue
        if lowered.startswith("question booklet"):
            continue
        cleaned_lines.append(line)

    return "\n".join(cleaned_lines)


def get_page_texts(pdf_path: Path, compare_ocr: bool) -> list[PageText]:
    pdf = fitz.open(pdf_path)
    ocr = RapidOCR()
    cache = load_page_cache()
    page_texts: list[PageText] = []

    for page_no in range(1, pdf.page_count + 1):
        key = str(page_no)
        cached = cache.get(key)
        if cached and cached.get("compare_ocr") == compare_ocr:
            page_texts.append(PageText(**cached["page_text"]))
            continue

        page = pdf[page_no - 1]
        text_layer = clean_page_text(page.get_text("text"))
        use_ocr = detect_ocr_needed(text_layer, page_no)
        ocr_text = None
        similarity = None

        if use_ocr or compare_ocr:
            ocr_text = clean_page_text(ocr_page(pdf, page_no, ocr))
            similarity = similarity_ratio(text_layer, ocr_text)

        selected_source, selected_text = choose_page_text(page_no, text_layer, ocr_text)
        page_text = PageText(
            page=page_no,
            source=selected_source,
            text=selected_text,
            ocr_text=ocr_text,
            similarity=similarity,
        )
        page_texts.append(page_text)
        cache[key] = {
            "compare_ocr": compare_ocr,
            "page_text": {
                "page": page_text.page,
                "source": page_text.source,
                "text": page_text.text,
                "ocr_text": page_text.ocr_text,
                "similarity": page_text.similarity,
            },
        }
        if page_no % 10 == 0:
            save_page_cache(cache)

    save_page_cache(cache)
    return page_texts


def parse_question_candidate(line: str) -> tuple[int, str, bool] | None:
    fixed = line
    fixed = re.sub(r"^\s*[Il]\.\s*", "1. ", fixed)
    fixed = re.sub(r"^\s*[Il]\)\s*", "1) ", fixed)

    for pattern in (INLINE_Q_RE, SPACE_Q_RE):
        match = pattern.match(fixed)
        if match:
            return int(match.group(1)), match.group(2).strip(), False

    bare = BARE_Q_RE.match(fixed)
    if bare:
        return int(bare.group(1)), "", True

    return None


def should_skip_question_one(rest: str) -> bool:
    lowered = rest.lower()
    return any(lowered.startswith(prefix) for prefix in INSTRUCTION_PREFIXES)


def looks_like_page_number(line: str) -> bool:
    return bool(re.fullmatch(r"\d{1,3}", line))


def build_exam_lines(page_texts: list[PageText], start_page: int, end_page: int) -> list[tuple[int, str]]:
    lines: list[tuple[int, str]] = []
    for page in range(start_page, end_page + 1):
        lines.append((page, f"[[PAGE {page}]]"))
        for raw in page_texts[page - 1].text.splitlines():
            cleaned = normalize_whitespace(raw)
            if cleaned:
                lines.append((page, cleaned))
    return lines


def extract_questions(lines: list[tuple[int, str]], question_total_hint: int) -> tuple[list[dict], list[int]]:
    started = False
    expected = 1
    current: dict | None = None
    questions: list[dict] = []
    missing_numbers: list[int] = []
    current_page = lines[0][0] if lines else 1

    for page_no, line in lines:
        marker = PAGE_MARKER_RE.match(line)
        if marker:
            current_page = int(marker.group(1))
            if current and current_page not in current["pages"]:
                current["pages"].append(current_page)
            continue

        candidate = parse_question_candidate(line)
        if candidate:
            number, rest, is_bare = candidate
            if not started:
                if number == 1 and not should_skip_question_one(rest):
                    started = True
                else:
                    continue

            allow_jump = not is_bare and rest and number > expected and number <= min(question_total_hint, expected + 5)
            if number == expected or allow_jump:
                if number > expected:
                    missing_numbers.extend(range(expected, number))
                    expected = number

                if current:
                    current["text"] = normalize_whitespace("\n".join(current["text_lines"]))
                    questions.append(current)

                current = {
                    "question_number": number,
                    "pages": [current_page],
                    "text_lines": [rest] if rest else [],
                }
                expected = number + 1
                continue

        if current and not looks_like_page_number(line):
            current["text_lines"].append(line)

    if current:
        current["text"] = normalize_whitespace("\n".join(current["text_lines"]))
        questions.append(current)

    return questions, missing_numbers


def classify_question(text: str) -> tuple[str, str, str]:
    normalized = text.lower()
    for subject, chapter, topic, patterns in CHAPTER_RULES:
        if any(re.search(pattern, normalized) for pattern in patterns):
            return subject, chapter, topic

    if re.search(r"[xyz]\s*=\s*|f\(x\)|\bmatrix\b|\bintegral\b|\blim\b|\bsin\b|\bcos\b", normalized):
        return "Mathematics", "General Mathematics", "Unclassified mathematics"
    if re.search(r"\bmol\b|\bacid\b|\bcompound\b|\breaction\b|\bbenzene\b|\borbital\b", normalized):
        return "Chemistry", "General Chemistry", "Unclassified chemistry"
    return "Physics", "General Physics", "Unclassified physics"


def normalize_question_text(text: str) -> str:
    text = text.replace("Correct Answer :", "\nCorrect Answer :")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_options(question_text: str) -> tuple[str, list[dict], str | None]:
    text = normalize_question_text(question_text)
    answer_match = ANSWER_RE.search(text)
    correct_option = answer_match.group(1).upper() if answer_match else None
    text_without_answer = ANSWER_RE.sub("", text).strip()

    markers = list(OPTION_MARKER_RE.finditer(text_without_answer))
    if not markers:
        return text_without_answer, [], correct_option

    stem = normalize_whitespace(text_without_answer[: markers[0].start()])
    options: list[dict] = []

    for index, marker in enumerate(markers):
        key = next(group for group in marker.groups() if group)
        start = marker.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text_without_answer)
        option_text = normalize_whitespace(text_without_answer[start:end])
        options.append({"key": key.upper(), "text": option_text})

    return stem, options, correct_option


def normalize_option_list(options: list[dict]) -> list[dict]:
    by_key: dict[str, str] = {}
    for option in options:
        key = option["key"].upper()
        text = option.get("text", "")
        if key not in by_key or (text and not by_key[key]):
            by_key[key] = text
    return [{"key": key, "text": by_key.get(key, "")} for key in ["A", "B", "C", "D", "E"]]


def notes_for_chapter(chapter: str) -> tuple[list[str], list[str]]:
    note = CHAPTER_NOTES.get(chapter)
    if not note:
        return [], []
    return note["concepts"], note["equations"]


def fetch_remote_pdf_lines(url: str) -> list[tuple[int, str]]:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    doc = fitz.open(stream=response.content, filetype="pdf")
    lines: list[tuple[int, str]] = []
    for page_no in range(1, doc.page_count + 1):
        lines.append((page_no, f"[[PAGE {page_no}]]"))
        page_text = clean_page_text(doc[page_no - 1].get_text("text"))
        for raw in page_text.splitlines():
            cleaned = normalize_whitespace(raw)
            if cleaned:
                lines.append((page_no, cleaned))
    return lines


def parse_answers_from_table_pdf(url: str) -> dict[int, str]:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    doc = fitz.open(stream=response.content, filetype="pdf")
    joined = "\n".join(doc[page].get_text("text") for page in range(doc.page_count))
    tokens = re.findall(r"(\d{1,3}|DEL|[A-E])", joined)
    answers: dict[int, str] = {}
    index = 0
    while index + 1 < len(tokens):
        if tokens[index].isdigit():
            answers[int(tokens[index])] = tokens[index + 1]
            index += 2
            continue
        index += 1
    return answers


def parse_2023_a1_answers() -> dict[int, str]:
    tokens = re.findall(r"(\d{1,3}|DEL|[A-E])", ANSWER_KEY_2023_A1)
    answers: dict[int, str] = {}
    index = 0
    while index + 1 < len(tokens):
        answers[int(tokens[index])] = tokens[index + 1]
        index += 2
    return answers


def enrich_record(record: dict, exam_answer_map: dict[int, str] | None = None) -> dict:
    stem, options, parsed_correct = parse_options(record["text"])
    options = normalize_option_list(options)
    correct_option = parsed_correct or (exam_answer_map or {}).get(record["question_number"])
    subject, chapter, topic = classify_question(stem or record["text"])
    concepts, equations = notes_for_chapter(chapter)

    answer_source = None
    if correct_option:
        answer_source_info = ANSWER_KEY_SOURCES.get(record["exam_key"])
        if answer_source_info:
            answer_source = {
                "label": answer_source_info["label"],
                "url": answer_source_info.get("url"),
                "pages": record["pages"],
            }
        elif "answer_source_url" in record:
            answer_source = {
                "label": record.get("answer_source_label", "Reference answer key"),
                "url": record.get("answer_source_url"),
                "pages": record["pages"],
            }
        else:
            answer_source = {
                "label": "Bundled PDF",
                "url": None,
                "pages": record["pages"],
            }

    return {
        "record_id": f"{record['exam_key']}-q{record['question_number']:03d}",
        "exam_key": record["exam_key"],
        "exam_info": record["exam_info"],
        "year": record["year"],
        "date_label": record["date_label"],
        "shift": record["shift"],
        "version_code": record.get("version_code"),
        "question_number": record["question_number"],
        "pages": record["pages"],
        "pdf_page": record["pages"][0] if record["pages"] else None,
        "subject": subject,
        "chapter": chapter,
        "topic": topic,
        "question_text": stem or record["text"],
        "options": options,
        "option_keys": [item["key"] for item in options],
        "correct_option": correct_option,
        "answer_status": "verified" if correct_option else "missing",
        "answer_source": answer_source,
        "concepts": concepts,
        "equations": equations,
        "text": record["text"],
    }


def dedupe_questions(records: Iterable[dict]) -> list[dict]:
    seen: dict[tuple[str, int], dict] = {}
    for record in records:
        key = (record["exam_key"], record["question_number"])
        existing = seen.get(key)
        if existing:
            existing["pages"] = sorted(set(existing["pages"] + record["pages"]))
            if len(record.get("text", "")) > len(existing.get("text", "")):
                existing["text"] = record["text"]
            continue
        seen[key] = record
    return list(seen.values())


def exam_key_for_entry(date_label: str | None, exam_info: str) -> str:
    return slugify(date_label or exam_info)


def build_question_bank(pdf_path: Path, compare_ocr: bool) -> tuple[list[dict], dict]:
    mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    page_texts = get_page_texts(pdf_path, compare_ocr=compare_ocr)
    records: list[dict] = []
    report = {"exams": [], "page_summary": {}}

    similarities = [p.similarity for p in page_texts if p.similarity is not None]
    if similarities:
        report["page_summary"] = {
            "pages": len(page_texts),
            "ocr_compared_pages": len(similarities),
            "similarity_min": min(similarities),
            "similarity_avg": statistics.mean(similarities),
            "ocr_source_pages": sum(1 for p in page_texts if p.source == "ocr"),
        }

    answer_maps: dict[str, dict[int, str]] = {
        "17-may-2023": parse_2023_a1_answers(),
        "2022-paper-i-physics-chemistry": parse_answers_from_table_pdf("https://www.cee.kerala.gov.in/keam2022/pdf/key_p1.pdf"),
    }

    for entry in mapping:
        exam_info = entry["exam_info"]
        question_total = infer_question_total(exam_info)
        header_text = "\n".join(page_texts[p - 1].text for p in range(entry["start_page"], min(entry["end_page"], entry["start_page"] + 1) + 1))
        date_label, year = parse_exam_date(exam_info, header_text, entry["start_page"])
        shift = extract_shift(exam_info)
        exam_key = exam_key_for_entry(date_label, exam_info)
        version_code = extract_version_code(header_text)

        source_override = EXAM_SOURCE_OVERRIDES.get(entry["start_page"])
        if source_override:
            lines = fetch_remote_pdf_lines(source_override["url"])
        else:
            lines = build_exam_lines(page_texts, entry["start_page"], entry["end_page"])

        questions, missing_numbers = extract_questions(lines, question_total)
        answer_map = answer_maps.get(exam_key)

        report["exams"].append(
            {
                "exam_info": exam_info,
                "exam_key": exam_key,
                "start_page": entry["start_page"],
                "end_page": entry["end_page"],
                "question_total_hint": question_total,
                "parsed_questions": len(questions),
                "missing_numbers": missing_numbers[:50],
                "date_label": date_label,
                "shift": shift,
                "version_code": version_code,
                "source_override": source_override["url"] if source_override else None,
            }
        )

        for question in questions:
            record = {
                "exam_key": exam_key,
                "exam_info": exam_info,
                "year": year,
                "date_label": date_label,
                "shift": shift,
                "version_code": version_code,
                "question_number": question["question_number"],
                "pages": question["pages"],
                "text": question["text"],
            }
            if source_override:
                record["answer_source_label"] = source_override["answer_source_label"]
                record["answer_source_url"] = source_override["url"]
            records.append(enrich_record(record, answer_map))

    deduped = dedupe_questions(records)
    deduped.sort(key=lambda item: (item["year"] or 0, item["date_label"] or "", item["question_number"]))
    return deduped, report


def write_markdown(records: list[dict]) -> str:
    lines = [
        "# KEAM Question Bank",
        "",
        "This file is generated from the master PDF, OCR, and linked answer-key sources for the AI assistant.",
        "",
    ]
    for record in records:
        label_parts = [record["date_label"] or record["exam_info"]]
        if record["shift"]:
            label_parts.append(record["shift"])
        header = " | ".join(label_parts)
        lines.append(f"## {header} | Q{record['question_number']}")
        lines.append("")
        lines.append(f"- Subject: {record['subject']}")
        lines.append(f"- Chapter: {record['chapter']}")
        lines.append(f"- Topic: {record['topic']}")
        lines.append(f"- Pages: {', '.join(str(p) for p in record['pages'])}")
        lines.append(f"- Answer Status: {record['answer_status']}")
        if record["correct_option"]:
            lines.append(f"- Correct Option: {record['correct_option']}")
        if record["answer_source"]:
            lines.append(f"- Answer Source: {record['answer_source']['label']}")
            if record["answer_source"].get("url"):
                lines.append(f"- Answer Source URL: {record['answer_source']['url']}")
        lines.append("")
        lines.append(record["question_text"] or "_No extractable text captured_")
        lines.append("")
        for option in record["options"]:
            lines.append(f"- {option['key']}: {option['text'] or '_Blank in extract_'}")
        if record["concepts"]:
            lines.append("")
            lines.append("### Key Concepts")
            lines.extend(f"- {item}" for item in record["concepts"])
        if record["equations"]:
            lines.append("")
            lines.append("### Linked Equations")
            lines.extend(f"- `{item}`" for item in record["equations"])
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--compare-ocr", action="store_true")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    records, report = build_question_bank(args.pdf, compare_ocr=args.compare_ocr)
    QUESTION_BANK_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    QUESTION_BANK_REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    QUESTION_BANK_MD_PATH.write_text(write_markdown(records), encoding="utf-8")

    print(f"Saved {len(records)} records to {QUESTION_BANK_PATH}")
    print(f"Saved report to {QUESTION_BANK_REPORT_PATH}")


if __name__ == "__main__":
    main()
