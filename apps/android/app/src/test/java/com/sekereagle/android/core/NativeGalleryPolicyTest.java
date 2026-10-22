package com.sekereagle.android.core;

import static org.junit.Assert.*;
import org.junit.Test;

public class NativeGalleryPolicyTest {
  @Test public void modesUseSeparateServerResourcesAndEncodedQueries() {
    assertEquals("/api/photos/assets?limit=60&search=%E7%8C%AB+%26+dog&cursor=next%2Fpage", NativeGalleryPolicy.listPath("PHOTO", "猫 & dog", "next/page"));
    assertEquals("/api/eagle/assets?limit=60", NativeGalleryPolicy.listPath("MATERIAL", "", ""));
    try { NativeGalleryPolicy.listPath("UNKNOWN", "", ""); fail(); } catch (IllegalArgumentException expected) {}
  }
  @Test public void mediaAlwaysUsesDerivedAuthenticatedSameOriginPaths() {
    assertEquals("/api/photos/assets/a/renditions/b/content", NativeGalleryPolicy.mediaPath("PHOTO", "a", "b"));
    for(String value : new String[]{"../a", "a/b", "https://evil", "", "a?secret=x"}) {
      try { NativeGalleryPolicy.mediaPath("PHOTO", value, "b"); fail(value); } catch(IllegalArgumentException expected) {}
    }
  }
  @Test public void sessionCookiesNeverAcceptForeignDomainsOrLeakRefreshTokensToMedia() {
    NativeCookies jar = new NativeCookies("https://photos.example");
    jar.accept("sekereagle_access=access; Path=/; HttpOnly; Secure");
    jar.accept("sekereagle_refresh=refresh; Path=/api/auth; HttpOnly; Secure");
    jar.accept("sekereagle_access=evil; Domain=evil.example; Path=/");
    jar.accept("unrelated=private; Path=/");
    assertEquals("sekereagle_access=access", jar.header("/api/photos/assets"));
    assertEquals("sekereagle_access=access; sekereagle_refresh=refresh", jar.header("/api/auth/refresh"));
    jar.accept("sekereagle_access=; Max-Age=0; Path=/");
    assertEquals("", jar.header("/api/photos/assets"));
    assertEquals("sekereagle_refresh=refresh", jar.header("/api/auth/logout"));
    jar.clear();
    assertEquals("", jar.header("/api/auth/refresh"));
  }
  @Test public void cookiesRejectHeaderInjectionAndPersistOnlyValidatedValues() {
    NativeCookies jar = new NativeCookies("http://localhost:42319");
    for (String value : new String[]{"sekereagle_access=x\r\nAuthorization: secret", "other=foo", "invalid", "sekereagle_access=x; Domain=localhost.evil"}) jar.accept(value);
    assertEquals("", jar.header("/api/auth/me"));
    jar.accept("sekereagle_access=ok; Path=/");
    jar.accept("sekereagle_refresh=refresh; Path=/api/auth");
    NativeCookies restored = new NativeCookies("http://localhost:42319");
    restored.restore(jar.snapshot());
    assertEquals(jar.header("/api/auth/refresh"), restored.header("/api/auth/refresh"));
  }
}
