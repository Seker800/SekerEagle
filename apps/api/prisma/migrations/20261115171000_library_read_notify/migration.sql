-- Wake the resident reader after a committed revision bump instead of polling every second.
CREATE OR REPLACE FUNCTION "EagleLibraryReadState_notify"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('eagle_library_read', NEW."ownerId" || ':' || NEW."libraryMode"::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "EagleLibraryReadState_notify"
AFTER INSERT OR UPDATE OF revision ON "EagleLibraryReadState"
FOR EACH ROW EXECUTE FUNCTION "EagleLibraryReadState_notify"();
