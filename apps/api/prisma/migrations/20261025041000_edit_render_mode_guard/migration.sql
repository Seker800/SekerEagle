-- The edit intent is permanently bound to its source library, like every other scoped table.
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleEditRender"
FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
