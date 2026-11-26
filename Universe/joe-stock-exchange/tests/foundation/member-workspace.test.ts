import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  MEMBER_DESTINATIONS,
  memberPageForPath,
  memberPath,
} from "../../apps/exchange-web/src/features/workspace/routes";

describe("Stage 1 member routes and isolated exchange draft", () => {
  it("preserves six shareable destinations, overview root alias and explicit unknown routes", () => {
    expect(MEMBER_DESTINATIONS.map((x) => x.label)).toEqual([
      "Account Overview",
      "Stock Listings",
      "News",
      "Posts",
      "Discussion",
      "My Company",
    ]);
    for (const destination of MEMBER_DESTINATIONS) {
      expect(memberPageForPath(destination.path + "/")).toBe(destination.page);
      expect(memberPath(destination.page)).toBe(destination.path);
    }
    expect(memberPageForPath("/")).toBe("account");
    expect(memberPageForPath("/settings")).toBe("settings");
    expect(memberPageForPath("/does-not-exist")).toBe("not-found");
  });
  it("promotes the additive schema and preserves existing market data", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const dir = new URL("../../database/migrations/", import.meta.url);
      for (const file of readdirSync(dir)
        .filter((x) => x.endsWith(".sql") && !x.startsWith("0008"))
        .sort())
        db.exec(readFileSync(new URL(file, dir), "utf8"));
      db.exec(
        readFileSync(
          new URL(
            "../../database/seed/0001_reference_data.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const before = db.prepare("SELECT * FROM assets ORDER BY id").all();
      db.exec(
        readFileSync(
          new URL(
            "../../database/migrations/0008_company_economy.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      expect(db.prepare("SELECT * FROM assets ORDER BY id").all()).toEqual(
        before,
      );
      const asset = String(
        db
          .prepare("SELECT id FROM assets WHERE asset_type='stock' LIMIT 1")
          .get()!.id,
      );
      db.exec(
        readFileSync(
          new URL("../../database/seed/local-members.sql", import.meta.url),
          "utf8",
        ),
      );
      db.prepare(
        "UPDATE assets SET developer_user_id='demo-alice' WHERE id=?",
      ).run(asset);
      db.prepare(
        "INSERT INTO company_posts(id,asset_id,author_id,title,body,state,created_at,updated_at) VALUES(?,?,'demo-alice','Sample','Body','published',1,1)",
      ).run("post", asset);
      expect(() =>
        db
          .prepare("UPDATE company_posts SET state='deleted' WHERE id='post'")
          .run(),
      ).toThrow();
      db.exec(
        "UPDATE company_posts SET state='deleted',title=NULL,body=NULL,version=version+1 WHERE id='post'",
      );
      expect(
        db
          .prepare("SELECT title,body,state FROM company_posts WHERE id='post'")
          .get(),
      ).toMatchObject({ title: null, body: null, state: "deleted" });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM trade_cost_lots").get()?.n,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
  it("imports existing quantities as unresolved without inventing a rounded basis", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const dir = new URL("../../database/migrations/", import.meta.url);
      for (const file of readdirSync(dir)
        .filter((f) => f.endsWith(".sql") && !f.startsWith("0008"))
        .sort())
        db.exec(readFileSync(new URL(file, dir), "utf8"));
      db.exec(
        readFileSync(
          new URL(
            "../../database/seed/0001_reference_data.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      db.exec(
        readFileSync(
          new URL("../../database/seed/local-members.sql", import.meta.url),
          "utf8",
        ),
      );
      const asset = String(
        db
          .prepare("SELECT id FROM assets WHERE asset_type='stock' LIMIT 1")
          .get()!.id,
      );
      db.prepare(
        "INSERT INTO holdings(id,user_id,asset_id,holding_kind,quantity,average_cost_cents) VALUES('legacy-member-holding','demo-alice',?,'stock',3,1234)",
      ).run(asset);
      const before = db
        .prepare("SELECT * FROM holdings WHERE id='legacy-member-holding'")
        .get();
      db.exec(readFileSync(new URL("0008_company_economy.sql", dir), "utf8"));
      expect(
        db
          .prepare("SELECT * FROM holdings WHERE id='legacy-member-holding'")
          .get(),
      ).toEqual(before);
      expect(
        db
          .prepare(
            "SELECT quantity_units,remaining_units,total_basis_cents,remaining_basis_cents,state FROM trade_cost_lots WHERE user_id='demo-alice'",
          )
          .get(),
      ).toMatchObject({
        quantity_units: 300,
        remaining_units: 300,
        total_basis_cents: null,
        remaining_basis_cents: null,
        state: "unresolved",
      });
    } finally {
      db.close();
    }
  });
});
