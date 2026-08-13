-- Forward-only correction for installations that already recorded migration 046
-- before the trip stop sequence constraint was refined to be deferrable.
-- Reorder uses SET CONSTRAINTS ... DEFERRED so a complete stop permutation can
-- be applied atomically without temporary invalid sequence values.

ALTER TABLE logistics.trip_stops
  DROP CONSTRAINT IF EXISTS trip_stops_sequence_unique;

ALTER TABLE logistics.trip_stops
  ADD CONSTRAINT trip_stops_sequence_unique
  UNIQUE (installation_id, trip_id, stop_sequence)
  DEFERRABLE INITIALLY IMMEDIATE;
