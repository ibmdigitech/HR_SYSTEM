-- Keep candidate resumes and company portal PDFs private in the database.
ALTER TABLE "Candidate"
    ADD COLUMN "resumeData" BYTEA,
    ADD COLUMN "resumeFileName" TEXT;

ALTER TABLE "CompanyDocument"
    ADD COLUMN "fileData" BYTEA;
