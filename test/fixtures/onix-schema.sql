-- Minimal ONIX tables for tests and the demo (PGlite / PostgreSQL), plus the view of docs/onix-view.sql on top.
-- Written from the analysis in #1 (section 3); NOT verified on a real ONIX database (#3).
-- Only the columns SkladPulz reads exist here. The view below is a verbatim copy of docs/onix-view.sql
-- (test/onix/onix-source.test.ts fails when the two differ).

CREATE TABLE document_types (
  id   integer PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE document_states (
  id_master       integer NOT NULL,
  history_version integer NOT NULL DEFAULT 1,
  name            text NOT NULL
);

CREATE TABLE stock_items (
  id     integer PRIMARY KEY,
  weight numeric(12, 4)
);

CREATE TABLE documents (
  id                  integer PRIMARY KEY,
  id_master           integer NOT NULL,
  ns_number           text NOT NULL,
  document_base_type  integer NOT NULL,
  history_version     integer NOT NULL DEFAULT 1,
  draft               integer NOT NULL DEFAULT 0,
  date_document       date,
  partner_name        text,
  id_document_types   integer REFERENCES document_types (id),
  weight_stock_items  numeric(12, 4)
);

CREATE TABLE document_items (
  id            integer PRIMARY KEY,
  id_documents  integer NOT NULL REFERENCES documents (id),
  amount        numeric(14, 4) NOT NULL,
  id_stock_items integer REFERENCES stock_items (id)
);

-- A table here; in ONIX it may be a function document_current_state(doc_id_master).
CREATE TABLE document_current_state (
  doc_id_master      integer PRIMARY KEY,
  id_document_states integer NOT NULL
);

-- BEGIN VIEW
CREATE OR REPLACE VIEW skl_aktivne_dl AS
SELECT d.id_master,
       d.ns_number,
       d.date_document,
       d.partner_name,
       ds.name                AS stav,
       dt.name                AS druh,
       d.weight_stock_items   AS hmotnost_kg,
       coalesce(l.pocet_poloziek, 0) AS pocet_poloziek,
       coalesce(l.pocet_mj, 0)       AS pocet_mj
FROM documents d
LEFT JOIN document_types dt ON dt.id = d.id_document_types
LEFT JOIN document_current_state cs ON cs.doc_id_master = d.id_master
LEFT JOIN document_states ds ON ds.id_master = cs.id_document_states
                            AND ds.history_version = 1
LEFT JOIN LATERAL (
    SELECT count(*) AS pocet_poloziek, sum(abs(i.amount)) AS pocet_mj
    FROM document_items i
    WHERE i.id_documents = d.id
      -- Stock lines only: lines with a stock item (not transport, services). Verify the column name
      -- `id_stock_items` on the real database. The customer may also want other lines excluded (docs/otazky.md #6).
      AND i.id_stock_items IS NOT NULL
) l ON true
WHERE d.document_base_type = 2050   -- delivery note
  AND d.history_version = 1         -- current version, not an old one
  AND d.draft = 0;                  -- not a draft
-- END VIEW
