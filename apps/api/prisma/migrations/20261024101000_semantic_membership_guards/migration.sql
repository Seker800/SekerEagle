-- Bring the existing semantic tables under the same immutable-mode contract as other scoped tables.
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleSmartFolderSemanticSnapshot" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleSmartFolderSemanticMatch" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
