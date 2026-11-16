CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleWatermarkPreset" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
