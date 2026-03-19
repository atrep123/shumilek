# Shumilek Pixel Workspace

Prvni Python UI prototype pro Shumilka.

Co umi:
- pixel-art vzhled s prirodni scenou
- mapovy workspace s bloky a spojnicemi
- leve nastrojove habitaty misto formulare plnych kolonek
- pravy detail panel pro aktualni uzel
- spodni session log ve stylu ridici konzole
- PixelLab bridge panel pro queue/poll workflow
- draft i live-MCP rezim nad stejnym API
- automaticke napojeni na lokalni extension bridge pres runtime manifest, kdyz je VS Code extension aktivni
- live asset preview, local cache refresh a open/save akce nad hotovymi assety
- recent asset history s filtrem All, Characters, Tilesets a pocty v labelu
- auto-poll s debounce/follow-up ochranou a ulozenim preferenci mezi spusteni
- externi runtime trace log v `%TEMP%\\shumilek_pixel_workspace_<session>.log` pro diagnostiku preview loadu a world feed promotion bez kolizi mezi behy
- externi fault trace log v `%TEMP%\\shumilek_ui_fault_<session>.log` pro zachyceni tvrdych padu procesu pod urovni beznych UI hooku a jejich sparovani s runtime session
- cached bootstrap world feed se obnovi jen z cerstveho tileset renderu a v subtitle se viditelne oznaci jako cached bootstrap

Co zatim neumí:
- perzistovat vyber konkretniho history assetu mezi refreshi aplikace

Poznamka k PixelLab MCP:
- v teto iteraci uz existuje bridge vrstva v [projects/shumilek_ui/pixellab_bridge.py](projects/shumilek_ui/pixellab_bridge.py)
- bridge umi queue character a topdown tileset jobu a umi polling stavu
- VS Code extension ted umi spustit lokalni localhost bridge nad oficialnim MCP klientem a zapisuje manifest do `projects/shumilek_ui/.pixellab-bridge.json`
- pokud extension nebo bridge nejsou dostupne, UI se automaticky prepne do draft-ready rezimu

Budouci napojeni:
- pridat stahovani preview assetu a jejich vykresleni primo v panelu
- pripadne dopsat detailnejsi diagnostiku bridge stavu primo do UI

Spusteni:

```powershell
python projects/shumilek_ui/main.py
```

Testy:

```powershell
python -m unittest discover -s projects/shumilek_ui/tests -p "test_*.py"
```