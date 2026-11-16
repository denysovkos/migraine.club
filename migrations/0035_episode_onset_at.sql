-- Add onset_at: true attack onset time, distinct from start_time which on
-- quick-add defaults to log time. Used by acute-med-timing program for
-- accurate onset-to-dose adherence.
--
-- Falls back to start_time when null (existing rows + quick-add without prompt).

ALTER TABLE episode
  ADD COLUMN onset_at timestamp;
