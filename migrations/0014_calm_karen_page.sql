DO $$ BEGIN
 ALTER TABLE "user_medications" ADD CONSTRAINT "user_medications_catalog_medication_id_medications_catalog_id_fk" FOREIGN KEY ("catalog_medication_id") REFERENCES "public"."medications_catalog"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
