ALTER TABLE "Branch" ADD CONSTRAINT "Branch_active_requires_manager_check"
  CHECK ("status" <> 'ACTIVE' OR "managerUserId" IS NOT NULL);
