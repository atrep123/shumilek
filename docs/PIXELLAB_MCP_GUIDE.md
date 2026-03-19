# PixelLab MCP Server — Kompletní návod pro AI agenta

> Tento dokument je referenční příručka pro AI agenta pracujícího ve VS Code s Copilot.
> Popisuje jak volat PixelLab MCP tools, jaké mají parametry, co vrací, a jak s výstupem pracovat.

---

## Obsah

1. [Prerekvizity — načtení tools](#1-prerekvizity)
2. [Přehled dostupných tools](#2-přehled-tools)
3. [Isometric Tile (ikony, bloky)](#3-isometric-tile)
4. [Tiles Pro (hex, iso, square — více variací)](#4-tiles-pro)
5. [Map Object (objekt s průhledným pozadím)](#5-map-object)
6. [Top-down Tileset (RPG mapa)](#6-top-down-tileset)
7. [Sidescroller Tileset (platformer)](#7-sidescroller-tileset)
8. [Character (postava s rotacemi)](#8-character)
9. [Animate Character (animace postavy)](#9-animate-character)
10. [Uložení výstupu na disk](#10-uložení-výstupu)
11. [Použití v Tkinter (PIL / Pillow)](#11-použití-v-tkinter)
12. [Časté chyby a tipy](#12-časté-chyby)

---

## 1. Prerekvizity

### Načtení tools (POVINNÉ)

Před prvním voláním jakéhokoli PixelLab toolu **musíš** tools načíst:

```
tool_search_tool_regex(pattern="mcp_pixellab")
```

Bez tohoto kroku jsou tools nedostupné a volání selžou. Stačí zavolat jednou za session — poté jsou všechny tools aktivní.

---

## 2. Přehled tools

| Oblast              | Create                                      | Get (polling)                              | List                                       | Delete                                      |
|---------------------|---------------------------------------------|--------------------------------------------|--------------------------------------------|---------------------------------------------|
| Isometric tiles     | `mcp_pixellab_create_isometric_tile`        | `mcp_pixellab_get_isometric_tile`          | `mcp_pixellab_list_isometric_tiles`        | `mcp_pixellab_delete_isometric_tile`        |
| Tiles Pro           | `mcp_pixellab_create_tiles_pro`             | `mcp_pixellab_get_tiles_pro`               | `mcp_pixellab_list_tiles_pro`              | `mcp_pixellab_delete_tiles_pro`             |
| Map Object          | `mcp_pixellab_create_map_object`            | `mcp_pixellab_get_map_object`              | —                                          | —                                           |
| Top-down tileset    | `mcp_pixellab_create_topdown_tileset`       | `mcp_pixellab_get_topdown_tileset`         | `mcp_pixellab_list_topdown_tilesets`       | `mcp_pixellab_delete_topdown_tileset`       |
| Sidescroller tileset| `mcp_pixellab_create_sidescroller_tileset`  | `mcp_pixellab_get_sidescroller_tileset`    | `mcp_pixellab_list_sidescroller_tilesets`  | `mcp_pixellab_delete_sidescroller_tileset`  |
| Character           | `mcp_pixellab_create_character`             | `mcp_pixellab_get_character`               | `mcp_pixellab_list_characters`             | `mcp_pixellab_delete_character`             |
| Animace             | `mcp_pixellab_animate_character`            | (přes `get_character`)                     | —                                          | —                                           |

### Obecný workflow

1. **Create** → vrátí ID okamžitě (asynchronní generování)
2. **Get** (polling) → kontroluj `status` pole:
   - `"processing"` → čekej a volej znovu za N sekund
   - `"completed"` → data jsou v `image_base64` / `download_url`
   - `"failed"` → chyba v `error`
3. **Ulož** base64 data na disk jako PNG

---

## 3. Isometric Tile

Nejjednodušší tool. Generuje jeden isometrický blok/dlaždici. Ideální na malé ikony, terénní kusy, herní předměty.

### Volání: `mcp_pixellab_create_isometric_tile`

| Parametr              | Typ       | Default           | Popis                                                               |
|-----------------------|-----------|-------------------|---------------------------------------------------------------------|
| **description** (req) | string    | —                 | Popis dlaždice, např. `"grass on top of dirt"`                      |
| size                  | int       | 32                | Velikost canvasu v px (16–64). Nad 24 px lepší kvalita.             |
| tile_shape            | string    | `"block"`         | `"thin tile"` / `"thick tile"` / `"block"`                          |
| outline               | string    | `"lineless"`      | `"single color outline"` / `"selective outline"` / `"lineless"`     |
| shading               | string    | `"basic shading"` | `"flat shading"` / `"basic shading"` / `"medium shading"` / `"detailed shading"` / `"highly detailed shading"` |
| detail                | string    | `"medium detail"` | `"low detail"` / `"medium detail"` / `"highly detailed"`           |
| text_guidance_scale   | float     | 8                 | Jak moc se drží popisu (1.0–20.0)                                   |
| seed                  | int\|null | null              | Seed pro reprodukovatelnost                                          |

### Příklad volání

```
mcp_pixellab_create_isometric_tile(
    description="dark crystal star icon, glowing cyan edges, pixel art",
    size=32,
    tile_shape="block",
    outline="single color outline",
    shading="basic shading",
    detail="medium detail",
    text_guidance_scale=8
)
```

### Odpověď (create)

Vrátí JSON s klíčovým polem:
- `tile_id` — UUID pro polling

### Polling: `mcp_pixellab_get_isometric_tile`

```
mcp_pixellab_get_isometric_tile(tile_id="<uuid>")
```

### Odpověď (get)

| Pole           | Hodnota                                     |
|----------------|---------------------------------------------|
| `status`       | `"processing"` / `"completed"` / `"failed"` / `"not_found"` |
| `eta_seconds`  | Odhad zbývajícího času (pokud processing)   |
| `image_base64` | Base64 PNG data (pokud completed)            |
| `download_url` | URL ke stažení PNG                           |
| `error`        | Chybová zpráva (pokud failed)                |

**Čas generování:** ~10–20 sekund. Polluj co ~15s.

### Smazání

```
mcp_pixellab_delete_isometric_tile(tile_id="<uuid>")
```

### Listování

```
mcp_pixellab_list_isometric_tiles(limit=10, offset=0)
```

---

## 4. Tiles Pro

Generuje **více dlaždic najednou** (1–16 ks). Podporuje hex, iso, square, octagon tvary.

### Volání: `mcp_pixellab_create_tiles_pro`

| Parametr              | Typ       | Default           | Popis                                                               |
|-----------------------|-----------|-------------------|---------------------------------------------------------------------|
| **description** (req) | string    | —                 | Popis — **čísluj** dlaždice: `"1). grass 2). dirt 3). stone"`       |
| n_tiles               | int\|null | null (auto-max)   | Počet dlaždic (1–16)                                                |
| tile_type             | string    | `"isometric"`     | `"hex"` / `"hex_pointy"` / `"isometric"` / `"octagon"` / `"square_topdown"` |
| tile_size             | int       | 32                | Velikost v px (16–128)                                              |
| tile_view             | string    | `"low top-down"`  | `"top-down"` / `"high top-down"` / `"low top-down"` / `"side"`     |
| tile_depth_ratio      | float\|null | null            | Hloubka 0.0–1.0 (override default z tile_view)                     |
| tile_height           | int\|null | null (auto)       | Výška px pro ne-čtvercové dlaždice (16–256)                         |
| tile_view_angle       | float\|null | null            | Spojitý úhel 0–90° (override tile_view). 0=side, 90=top-down       |
| seed                  | int\|null | null              | Seed                                                                 |
| style_images          | string\|null | null           | JSON array s ref. obrázky pro style matching (viz níže)             |
| style_options         | string\|null | null           | JSON: `{"color_palette": true, "outline": true, "detail": true, "shading": true}` |

### Style matching mode

Místo `tile_type` / `tile_size` / `tile_view` pošli `style_images`:

```json
[{"base64": "iVBORw0...", "width": 64, "height": 80}]
```

AI pak vytvoří dlaždice ve stejném stylu.

### Příklad volání

```
mcp_pixellab_create_tiles_pro(
    description="1). grass tile 2). dirt tile 3). stone tile 4). water tile",
    n_tiles=4,
    tile_type="isometric",
    tile_size=32,
    tile_view="low top-down"
)
```

### Odpověď

Create vrátí `tile_id`. Get přes:

```
mcp_pixellab_get_tiles_pro(tile_id="<uuid>")
```

Odpověď obsahuje pole `tiles` s base64 PNG pro každou variaci.

**Čas generování:** ~15–30 sekund.

---

## 5. Map Object

Generuje **jeden objekt s průhledným pozadím** pro herní mapy. Podporuje style matching s pozadím.

### Volání: `mcp_pixellab_create_map_object`

| Parametr              | Typ          | Default              | Popis                                                               |
|-----------------------|--------------|----------------------|---------------------------------------------------------------------|
| **description** (req) | string       | —                    | Popis objektu, např. `"wooden barrel"`, `"stone fountain"`          |
| width                 | int\|null    | null                 | Šířka canvasu px (32–400). Povinné v basic mode.                    |
| height                | int\|null    | null                 | Výška canvasu px (32–400). Povinné v basic mode.                    |
| view                  | string       | `"high top-down"`    | `"low top-down"` / `"high top-down"` / `"side"`                    |
| outline               | string       | `"single color outline"` | `"single color outline"` / `"selective outline"` / `"lineless"` |
| shading               | string       | `"medium shading"`   | `"flat shading"` / `"basic shading"` / `"medium shading"` / `"detailed shading"` |
| detail                | string       | `"medium detail"`    | `"low detail"` / `"medium detail"` / `"high detail"`               |
| background_image      | string\|null | null                 | JSON pro style matching (viz níže)                                   |
| inpainting            | string\|null | null                 | JSON maska pro inpainting (viz níže)                                 |

### Dva režimy

**1. Basic mode** (bez `background_image`):
- Generuje samostatný objekt
- `width` + `height` povinné
- Max plocha: 400×400 = 160 000 px

**2. Style matching mode** (s `background_image`):
- AI analyzuje okolní pixely a generuje ve stejném stylu
- `width`/`height` automaticky z obrázku
- Max plocha pro inpainting: 192×192 = 36 864 px

### background_image formáty

**Path (doporučeno — šetří tokeny):**
```json
{"type": "path", "path": "assets/my-game-map.png"}
```
Vrátí curl příkaz ke spuštění. Ušetří 5 000–20 000 tokenů.
Pozor: velké obrázky (>192×192) mohou způsobit chybu "argument list too long" s curl.

**Base64 (žere tokeny):**
```json
{"type": "base64", "base64": "iVBORw0KGgo..."}
```

### inpainting konfigurace

Pokud pošleš `background_image` **bez** `inpainting`, použije se default: `oval 60%`.

| Typ       | JSON                                          | Popis                                    |
|-----------|-----------------------------------------------|------------------------------------------|
| Oval      | `{"type": "oval", "fraction": 0.3}`           | Centrovaný ovál, 30% pozadí              |
| Rectangle | `{"type": "rectangle", "fraction": 0.5}`      | Centrovaný obdélník, 50% pozadí          |
| Custom    | `{"type": "mask", "mask_image": "base64..."}` | Vlastní maska: černá=kontext, bílá=gen   |

`fraction` rozsah: 0.05–0.95

### Příklad — basic mode

```
mcp_pixellab_create_map_object(
    description="wooden barrel",
    width=64,
    height=64,
    view="high top-down",
    outline="single color outline",
    shading="medium shading"
)
```

### Příklad — style matching

```
mcp_pixellab_create_map_object(
    description="stone fountain",
    background_image="{\"type\": \"path\", \"path\": \"assets/map.png\"}",
    inpainting="{\"type\": \"oval\", \"fraction\": 0.4}"
)
```

### Polling

```
mcp_pixellab_get_map_object(object_id="<uuid>")
```

**Čas generování:** ~15–30 sekund.

---

## 6. Top-down Tileset

Wang tileset pro top-down RPG mapy s corner-based autotiling. Vrátí 16 (nebo 23 při transition_size=1.0) dlaždic.

### Volání: `mcp_pixellab_create_topdown_tileset`

| Parametr                 | Typ          | Default              | Popis                                                          |
|--------------------------|--------------|----------------------|----------------------------------------------------------------|
| **lower_description** (req) | string    | —                    | Spodní terén: `"ocean water"`, `"dirt path"`                   |
| **upper_description** (req) | string    | —                    | Horní terén: `"sandy beach"`, `"grass"`                        |
| transition_description   | string\|null | null                 | Přechodová vrstva (povinné pokud transition_size > 0)          |
| transition_size          | float        | 0                    | Velikost přechodu: `0.0` / `0.25` / `0.5` / `1.0`             |
| tile_size                | object       | `{"width":16,"height":16}` | Rozměry dlaždice (16 nebo 32 px)                         |
| view                     | string       | `"high top-down"`    | `"low top-down"` / `"high top-down"`                           |
| outline                  | string\|null | null                 | `"single color outline"` / `"selective outline"` / `"lineless"` |
| shading                  | string\|null | null                 | `"flat shading"` / `"basic shading"` / `"medium shading"` / `"detailed shading"` / `"highly detailed shading"` |
| detail                   | string\|null | null                 | `"low detail"` / `"medium detail"` / `"highly detailed"`       |
| text_guidance_scale      | float        | 8                    | Prompt adherence (1–20)                                         |
| tile_strength            | float        | 1                    | Pattern consistency (0.1–2.0)                                   |
| tileset_adherence        | int          | 100                  | Structure strictness (0–500)                                    |
| tileset_adherence_freedom | int         | 500                  | Structure flexibility (0–900)                                   |
| lower_base_tile_id       | string\|null | null                 | ID existující dlaždice pro navázání spodního terénu             |
| upper_base_tile_id       | string\|null | null                 | ID existující dlaždice pro navázání horního terénu              |
| seed                     | —            | —                    | Není podporován                                                  |

### Navazování tilesetů (connected tilesets)

```
1. Vytvoř tileset A (ocean → beach)
2. Zavolej get_topdown_tileset → získej base_tile_id pro "beach"
3. Vytvoř tileset B s lower_base_tile_id = beach_tile_id (beach → grass)
4. Opakuj pro další terémy
```

### Příklad

```
mcp_pixellab_create_topdown_tileset(
    lower_description="ocean water",
    upper_description="sandy beach",
    transition_description="wet sand with foam",
    transition_size=0.5,
    tile_size={"width": 16, "height": 16},
    view="high top-down",
    shading="basic shading"
)
```

### Polling

```
mcp_pixellab_get_topdown_tileset(tileset_id="<uuid>")
```

**Čas generování:** ~100 sekund.

---

## 7. Sidescroller Tileset

Tilesets pro 2D platformer hry se side-view perspektivou. Průhledné pozadí, ploché platformy (bez svahů).

### Volání: `mcp_pixellab_create_sidescroller_tileset`

| Parametr                    | Typ          | Default                     | Popis                                                           |
|-----------------------------|--------------|-----------------------------|-----------------------------------------------------------------|
| **lower_description** (req) | string       | —                           | Materiál platformy: `"stone brick"`, `"wooden planks"`          |
| **transition_description** (req) | string  | —                           | Povrchová vrstva: `"grass"`, `"snow cover"`, `"moss"`           |
| transition_size             | float        | 0                           | Jak moc povrchové vrstvy (0.0 / 0.25 / 0.5)                    |
| tile_size                   | object       | `{"width":16,"height":16}`  | Rozměry (16 nebo 32 px)                                         |
| base_tile_id                | string\|null | null                        | Reference tile pro navazování                                    |
| outline                     | string\|null | null                        | Styl obrysů                                                      |
| shading                     | string\|null | null                        | Styl stínování                                                    |
| detail                      | string\|null | null                        | Úroveň detailu                                                   |
| text_guidance_scale         | float        | 8                           | Prompt adherence (1–20)                                          |
| tile_strength               | float        | 1                           | Pattern consistency (0.1–2.0)                                    |
| tileset_adherence           | int          | 100                         | Structure strictness (0–500)                                     |
| tileset_adherence_freedom   | int          | 500                         | Structure flexibility (0–900)                                    |
| seed                        | int\|null    | null                        | Seed pro reprodukovatelnost                                      |

### Příklad

```
mcp_pixellab_create_sidescroller_tileset(
    lower_description="stone brick",
    transition_description="grass",
    transition_size=0.25,
    tile_size={"width": 16, "height": 16}
)
```

### Polling

```
mcp_pixellab_get_sidescroller_tileset(
    tileset_id="<uuid>",
    include_example_map=true
)
```

**Čas generování:** ~100 sekund.

---

## 8. Character

Založí postavu se 4 nebo 8 směrovými rotacemi.

### Volání: `mcp_pixellab_create_character`

| Parametr              | Typ          | Default                        | Popis                                                                    |
|-----------------------|--------------|--------------------------------|--------------------------------------------------------------------------|
| **description** (req) | string      | —                              | Vzhled: `"cute wizard with blue robes"`                                  |
| name                  | string\|null | null                          | Jméno pro referenci                                                       |
| body_type             | string       | `"humanoid"`                  | `"humanoid"` (bipedální) / `"quadruped"` (čtyřnožec — vyžaduje template) |
| template              | string\|null | null                          | Quadruped template: `"bear"` / `"cat"` / `"dog"` / `"horse"` / `"lion"` |
| size                  | int          | 48                            | Canvas px (16–128). Postava ~60% výšky canvasu.                          |
| n_directions          | int          | 8                             | 4 nebo 8 směrů. V pro mode ignorováno (vždy 8).                         |
| view                  | string       | `"low top-down"`              | `"low top-down"` / `"high top-down"` / `"side"`                         |
| mode                  | string       | `"standard"`                  | `"standard"` (1 gen, template skeleton) / `"pro"` (20–40 gen, AI ref)   |
| outline               | string\|null | `"single color black outline"` | `"single color black outline"` / `"single color outline"` / `"selective outline"` / `"lineless"` |
| shading               | string\|null | `"basic shading"`             | `"flat shading"` / `"basic shading"` / `"medium shading"` / `"detailed shading"` |
| detail                | string\|null | `"medium detail"`             | `"low detail"` / `"medium detail"` / `"high detail"`                    |
| ai_freedom            | int          | 750                           | Kreativita (100=strict, 999=creative)                                    |
| proportions           | string\|null | `preset:default`              | JSON — viz níže                                                           |

### Proporce (humanoid only)

**Preset:**
```json
{"type": "preset", "name": "chibi"}
```
Dostupné: `default`, `chibi`, `cartoon`, `stylized`, `realistic_male`, `realistic_female`, `heroic`

**Custom:**
```json
{"type": "custom", "head_size": 1.5, "arms_length": 0.8, "legs_length": 0.9, "shoulder_width": 0.7, "hip_width": 0.8}
```
Všechny hodnoty 0.5–2.0.

### Standard vs Pro mode

| Vlastnost      | Standard                          | Pro                                     |
|----------------|-----------------------------------|-----------------------------------------|
| Cena           | 1 generace                        | 20–40 generací (dle size)               |
| Směry          | 4 nebo 8                          | Vždy 8                                  |
| Metoda         | Template skeleton                  | AI reference-based                      |
| Používá        | Všechny parametry                  | Jen description, name, body_type, template, size, view |
| Kvalita        | Dobrá                             | Lepší pro detailní/unikátní postavy     |

### Příklad

```
mcp_pixellab_create_character(
    description="dark elf rogue with purple cloak",
    name="Shadow Elf",
    body_type="humanoid",
    size=48,
    n_directions=4,
    view="low top-down",
    mode="standard"
)
```

### Odpověď

Vrátí `character_id` + `job_id`.

### Polling: `mcp_pixellab_get_character`

```
mcp_pixellab_get_character(
    character_id="<uuid>",
    include_preview=true
)
```

### Odpověď (get)

| Pole                   | Popis                                                    |
|------------------------|----------------------------------------------------------|
| `status`               | Per-direction status rotací                               |
| `rotation_images`      | Dict: direction → base64 PNG                              |
| `animations`           | List animací s jejich statusem                            |
| `download_url`         | URL ke stažení ZIP se vším                                |
| `available_animations` | List template animation ID pro `animate_character`        |

**Čas generování:** 2–5 minut. Polluj co ~30 sekund.

### Listování

```
mcp_pixellab_list_characters(limit=10, offset=0, tags="wizard,fire")
```

`tags` — filtruje postavy, ANY match (OR logika).

### Smazání

```
mcp_pixellab_delete_character(character_id="<uuid>", confirm=true)
```

---

## 9. Animate Character

Přidává animace k existující postavě.

### Volání: `mcp_pixellab_animate_character`

| Parametr                | Typ           | Default | Popis                                                                  |
|-------------------------|---------------|---------|------------------------------------------------------------------------|
| **character_id** (req)  | string        | —       | UUID z `create_character`                                              |
| template_animation_id   | string\|null  | null    | Template animace (1 gen/direction). Viz seznam níže.                   |
| action_description      | string\|null  | null    | Custom popis akce (20–40 gen/direction!) — bez template                |
| animation_name          | string\|null  | null    | Vlastní jméno animace                                                   |
| directions              | list\|null    | null    | Konkrétní směry. Template: všechny. Custom: jen south.                 |
| confirm_cost            | bool          | false   | **NIKDY true na první volání!** Viz bezpečnostní postup níže.          |

### Dva režimy animací

#### A) Template animace (levné — 1 gen/direction)

Pošli `template_animation_id`. Automaticky animuje všechny směry postavy.

```
mcp_pixellab_animate_character(
    character_id="<uuid>",
    template_animation_id="walk"
)
```

**Dostupné humanoid template animace:**

`backflip`, `breathing-idle`, `cross-punch`, `crouched-walking`, `crouching`,
`drinking`, `falling-back-death`, `fight-stance-idle-8-frames`, `fireball`,
`flying-kick`, `front-flip`, `getting-up`, `high-kick`, `hurricane-kick`,
`jumping-1`, `jumping-2`, `lead-jab`, `leg-sweep`, `picking-up`,
`pull-heavy-object`, `pushing`, `roundhouse-kick`, `running-4-frames`,
`running-6-frames`, `running-8-frames`, `running-jump`, `running-slide`,
`sad-walk`, `scary-walk`, `surprise-uppercut`, `taking-punch`, `throw-object`,
`two-footed-jump`, `walk`, `walk-1`, `walk-2`, `walking`, `walking-2`–`walking-10`,
`walking-4-frames`, `walking-6-frames`, `walking-8-frames`

**Quadruped animace** závisí na template (bear/cat/dog/horse/lion). Použij `get_character()` pro seznam.

#### B) Custom animace (drahé — 20–40 gen/direction!)

Bez `template_animation_id`, pošli `action_description`.

**BEZPEČNOSTNÍ POSTUP (POVINNÝ):**

```
Krok 1 — PRVNÍ volání, confirm_cost=false (zjistí cenu):

    mcp_pixellab_animate_character(
        character_id="<uuid>",
        action_description="dancing gracefully",
        directions=["south", "east"],
        confirm_cost=false
    )

    → Odpověď ukáže celkovou cenu v generacích.

Krok 2 — Ukaž cenu uživateli, zeptej se na souhlas.

Krok 3 — TEPRVE po souhlasu, confirm_cost=true:

    mcp_pixellab_animate_character(
        character_id="<uuid>",
        action_description="dancing gracefully",
        directions=["south", "east"],
        confirm_cost=true
    )
```

### Platné směry

`south`, `north`, `east`, `west`, `south-east`, `south-west`, `north-east`, `north-west`

### Čas generování

Template: ~2–4 minuty. Custom: ~2–4 minuty per direction.
Polluj přes `get_character`.

---

## 10. Uložení výstupu na disk

### Z base64 — Python (v terminálu)

```python
import base64
data = base64.b64decode("<base64_string>")
with open("assets/pixelart/icon_name.png", "wb") as f:
    f.write(data)
```

### Z base64 — PowerShell

```powershell
[System.IO.File]::WriteAllBytes(
    "C:\path\to\icon_name.png",
    [System.Convert]::FromBase64String("<base64_string>")
)
```

### Z base64 — přes create_file tool (pokud je string krátký)

Tool `create_file` nepodporuje binární obsah — **nepoužívej** pro PNG. Vždy použij terminál.

### Z download_url — PowerShell

```powershell
Invoke-WebRequest -Uri "<download_url>" -OutFile "assets/pixelart/icon_name.png"
```

### Doporučený adresář

```
projects/<projekt>/assets/pixelart/<name>.png
```

---

## 11. Použití v Tkinter (PIL / Pillow)

### Načtení s fallbackem

```python
try:
    from PIL import Image, ImageTk
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False
```

### Asset loading helper

```python
_ASSET_DIR = Path(__file__).parent / "assets" / "pixelart"
_loaded_images: dict[str, ImageTk.PhotoImage] = {}

def _load_icon(name: str, size: tuple[int, int] = (20, 20)):
    """Načte PNG z assets/pixelart, resize s NEAREST pro pixel-art."""
    if not _HAS_PIL:
        return None
    if name in _loaded_images:
        return _loaded_images[name]
    path = _ASSET_DIR / f"{name}.png"
    if not path.exists():
        return None
    try:
        img = Image.open(path).convert("RGBA")
        img = img.resize(size, Image.NEAREST)
        photo = ImageTk.PhotoImage(img)
        _loaded_images[name] = photo  # MUSÍŠ držet referenci — jinak GC smaže
        return photo
    except Exception:
        return None
```

### Použití v kódu

```python
# Na tlačítku
icon = _load_icon("icon_save", (20, 20))
if icon:
    btn = tk.Button(parent, image=icon, bg="#0E0B18", bd=0)
    btn.pack()

# Na labelu
star = _load_icon("crystal_star", (16, 16))
if star:
    self._star_ref = star  # drž referenci!
    tk.Label(bar, image=star, bg="#080610").pack(side="left")

# Na canvasu
logo = _load_icon("logo_hive", (48, 48))
if logo:
    self._logo_ref = logo
    canvas.create_image(30, 30, image=logo)
```

### Klíčové pravidlo

**VŽDY drž referenci na `ImageTk.PhotoImage`** v `self._xxx` nebo v globálním dict.
Bez toho Python garbage collector smaže obrázek a uvidíš prázdné místo.

---

## 12. Časté chyby a tipy

### Chyby

| Problém                                | Řešení                                                      |
|----------------------------------------|--------------------------------------------------------------|
| Tool volání selže / unknown tool       | Zapomněl jsi `tool_search_tool_regex(pattern="mcp_pixellab")` |
| `status: "processing"` pořád           | Nepolluj příliš často. Čekej 15–30s mezi voláními.           |
| Obrázek se nezobrazí v Tkinter         | Nedržíš referenci na ImageTk.PhotoImage (GC).                |
| `argument list too long` (curl)        | Obrázek moc velký pro path mode. Použi base64 nebo zmenši.  |
| Custom animace spotřebovala moc gen    | VŽDY confirm_cost=false první, zeptej se uživatele.         |
| Dlaždice nematchují styl               | Použi `base_tile_id` / `lower_base_tile_id` pro navázání.   |

### Tipy

- **Velikost 24+ px** u isometric tiles dává lepší výsledky než 16 px
- **Čísluj dlaždice** v Tiles Pro: `"1). grass 2). dirt 3). stone"` — lepší kontrola
- **Seed** pro reprodukovatelnost — stejný seed + popis = stejný výsledek
- **text_guidance_scale**: nízká (1–4) = kreativnější, vysoká (12–20) = přesnější k popisu
- **Pro mode** u character: dražší ale kvalitnější, vždy 8 směrů
- **Style matching** u map object: pošli pozadí a AI automaticky matchne barvy/stín
- **Navazování tilesetů**: vždy získej base tile ID z prvního tilesetu a použi ho v dalším

### Typický workflow pro sadu ikon

```
1. tool_search_tool_regex(pattern="mcp_pixellab")

2. Pro každou ikonu:
   a. mcp_pixellab_create_isometric_tile(description="...", size=32)
      → zapamatuj tile_id
   
   b. Čekej ~15s
   
   c. mcp_pixellab_get_isometric_tile(tile_id="<id>")
      → pokud status="processing", čekej a opakuj
      → pokud status="completed", máš image_base64
   
   d. Ulož base64 na disk přes terminál:
      [System.IO.File]::WriteAllBytes("assets/pixelart/icon_name.png",
          [System.Convert]::FromBase64String($base64))

3. V kódu načti přes _load_icon("icon_name", (20, 20))
```

### Existující assety v tomto projektu

Složka: `projects/shumilek_hive/assets/pixelart/` (20 souborů):

| Soubor              | Popis                     | Použití                           |
|---------------------|---------------------------|-----------------------------------|
| `logo_hive.png`     | Logo Shumilek Hive        | Titlebar, velké zobrazení         |
| `bg_obsidian.png`   | Pozadí textura            | Dekorativní                       |
| `deco_honeycomb.png`| Honeycomb dekorace        | Sidebar, right panel              |
| `crystal_star.png`  | Krystalová hvězda         | Statusbar, related notes          |
| `icon_save.png`     | Ikona uložení             | Toolbar                           |
| `icon_new.png`      | Ikona nového souboru      | Toolbar                           |
| `icon_delete.png`   | Ikona smazání             | Toolbar                           |
| `icon_folder.png`   | Ikona složky              | Sidebar, file tree                |
| `icon_search.png`   | Ikona hledání             | Toolbar                           |
| `icon_edit.png`     | Ikona editace             | Toolbar                           |
| `icon_editor.png`   | Ikona editoru             | Tab, view switch                  |
| `icon_preview.png`  | Ikona náhledu             | Tab, view switch                  |
| `icon_graph.png`    | Ikona grafu               | Tab, backlinks                    |
| `icon_pipeline.png` | Ikona pipeline            | Tab, schema view                  |
| `icon_hive.png`     | Ikona hive                | Tab, knowledge score              |
| `icon_timeline.png` | Ikona timeline            | Tab                               |
| `icon_split.png`    | Ikona split view          | Toolbar                           |
| `icon_goal.png`     | Ikona word goal           | Vault stats                       |
| `icon_pin.png`      | Ikona pinu                | Pinned notes                      |
| `icon_ai_star.png`  | AI hvězda                 | AI panel, hive view               |
