-- Constraint refinement belonging to the same registered migration 046.
-- Reordering a complete stop set must be atomic and cannot use invalid temporary sequences.

ALTER TABLE logistics.trip_stops
  DROP CONSTRAINT IF EXISTS trip_stops_sequence_unique;

ALTER TABLE logistics.trip_stops
  ADD CONSTRAINT trip_stops_sequence_unique
  UNIQUE (installation_id, trip_id, stop_sequence)
  DEFERRABLE INITIALLY IMMEDIATE;
