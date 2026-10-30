-- View `skl_aktivne_dl` for SkladPulz (#3). Install once in the customer's ONIX database (PostgreSQL 16).
--
-- One row per current delivery note (DL). The view does NOT filter by state, type or date:
-- SkladPulz does that from config.json (onix.activeStates, onix.documentTypes, onix.daysBack),
-- so the customer's answers (#1, section 7) never need a database change.
--
-- Written from the analysis in #1; NOT yet verified on a real ONIX database. Column and table names to check:
--   documents (id, id_master, ns_number, date_document, partner_name, id_document_types, weight_stock_items,
--              document_base_type, history_version, draft), document_items (id_documents, amount, id_stock_items),
--   document_types (id, name), document_states (id_master, history_version, name),
--   document_current_state (doc_id_master, id_document_states).

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

-- Read-only user for SkladPulz. Create it once, with your own password:
--   CREATE ROLE skladpulz_ro LOGIN PASSWORD 'change-me';
-- The view runs with its owner's rights, so the user needs nothing on the underlying tables.
GRANT USAGE ON SCHEMA public TO skladpulz_ro;
GRANT SELECT ON skl_aktivne_dl TO skladpulz_ro;
