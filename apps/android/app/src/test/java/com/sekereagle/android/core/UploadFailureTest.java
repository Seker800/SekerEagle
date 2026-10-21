package com.sekereagle.android.core;
import static org.junit.Assert.*;
import org.junit.Test;
public class UploadFailureTest {
 @Test public void storageStatusNeverRevokesApiCredentials(){
  assertFalse(new UploadFailure(403,UploadFailure.Endpoint.SIGNED_PART).invalidatesCredential());
  assertFalse(new UploadFailure(401,UploadFailure.Endpoint.SIGNED_PART).invalidatesCredential());
  assertFalse(new UploadFailure(403,UploadFailure.Endpoint.API).invalidatesCredential());
  assertTrue(new UploadFailure(401,UploadFailure.Endpoint.API).invalidatesCredential());
 }
 @Test public void permanentValidationErrorsAreDistinctFromRetryableSessionAndNetworkErrors(){
  for(int status:new int[]{400,413,415,422})assertTrue(new UploadFailure(status,UploadFailure.Endpoint.API).permanent());
  for(int status:new int[]{401,403,404,409,429,500,503})assertFalse(new UploadFailure(status,UploadFailure.Endpoint.API).permanent());
  assertFalse(new UploadFailure(400,UploadFailure.Endpoint.SIGNED_PART).permanent());
 }
}
