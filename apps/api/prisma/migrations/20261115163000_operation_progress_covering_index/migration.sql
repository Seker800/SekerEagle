-- Progress polling aggregates only the operation's items; cover status, error and weight.
CREATE INDEX "EagleAssetOperationItem_operationId_status_errorCode_weight_idx"
  ON "EagleAssetOperationItem" ("operationId", "status", "errorCode", "weight");
