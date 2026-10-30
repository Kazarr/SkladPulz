# SkladPulz

Times how long each warehouse worker takes to pick or pack a delivery note, and compares workers by volume and speed. Slovak terms are the customer's words and the database's names; the English term is the code's name.

## Language

**Delivery note** (`dodaci_list`, DL):
A KROS ONIX document of base type 2050 that the worker picks or packs, identified by its full number (`ns_number`). SkladPulz keeps a read-only cache of it.
_Avoid_: order, document, invoice

**Worker** (`zamestnanec`):
A person who picks or packs, identified by a card code `Z` + four digits (`Z0012`). Not an ONIX user.
_Avoid_: user, employee account, operator

**Station** (`stanica`):
A browser page bound to one scanner place (a picking point or a packing table), with an optional default activity. Workers may take turns at one station.
_Avoid_: terminal, device, client

**Activity** (`cinnost`):
What a record measures: `VYCH` (picking, vychystanie) or `BAL` (packing, balenie).
_Avoid_: task, operation, job

**Record** (`zaznam`):
One worker doing one activity on one delivery note, from start to end. A delivery note has at most one counted record per activity.
_Avoid_: measurement, entry, session

**Net time** (`cisty_cas_s`):
A record's end minus start minus its pauses, in seconds. The basis of every speed.
_Avoid_: duration, elapsed time

**Snapshot** (`pocet_poloziek`, `pocet_mj`, `hmotnost_kg` on the record):
The delivery note's line count, unit count and weight copied onto the record when it ends; later changes to the note do not change it. A record that ended before ONIX supplied the note has none yet; the next sync (or a lookup) fills it in, and until then the record waits for a manager and does not count. Confirming it counts it with 0 lines and 0 kg.

**Control code** (`riadiaci kód`):
A printed barcode that drives the station: `C-VYCH`, `C-BAL`, `C-KONIEC`, `C-PAUZA`, `C-POKRAC`, `C-ODHLAS`.
_Avoid_: command, action code

**Scan** (`pípnutie`):
One code read by the scanner and sent to a station, logged in `scan_log` with its outcome.

**Record status** (`stav`):
`ok` (ended by a scan), `neukoncene` (closed automatically at shift end), `opravene` (corrected by a manager), `vylucene` (excluded by a manager).

**Suspect record** (`podozrenie`):
A record whose net time is under the short limit (`kratky`, default 20 s) or over the long limit (`dlhy`). It counts only after a manager confirms it.

**Duplicate** (`duplicita`):
A record flagged because its delivery note has another non-excluded record of the same activity. When a second worker starts the same note and activity, both records are flagged; when a worker scans a note they already finished with the same activity, the new record is flagged. It counts only after a manager confirms it; the manager confirms one and excludes the other. Whether two people may legitimately share one note is a customer question (`docs/otazky.md`, row 13).

**Counted record** (`zaznam_hodnotene` view):
A record that enters averages and speeds: status `ok` or `opravene`, and, unless a manager confirmed it, not suspect, not a duplicate and with a snapshot.
_Avoid_: valid record

**Shift** (`zmena`):
A configured daily time window (`06:00–14:00`). A record still running at the end of the shift it started in is closed as `neukoncene`.

**Performance index** (`vykonovy index`):
Standard time of a record divided by its net time, scaled so the team average is 100 %. Standard time = fixed time per note + time per line + time per kg, set per activity.
_Avoid_: score, rating

**Index weights** (`vahy_indexu`):
The three numbers of the standard time (fixed seconds per note, seconds per line, seconds per kg) of one activity. Placeholders until a manager saves them, preferably estimated from 2-4 weeks of counted records.

**Band** (`pasmo`):
Top 30 % / middle 40 % / bottom 30 % of the workers by performance index, shown instead of an exact rank.
_Avoid_: tier, grade

**Manager** (`vedúci`):
The person who reviews and corrects records and reads reports; signs in with a name and password from the configuration.
_Avoid_: admin, supervisor
