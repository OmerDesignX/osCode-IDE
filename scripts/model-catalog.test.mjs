import assert from "node:assert/strict";
import test from "node:test";
import {
  filesForVariant,
  modelRepository,
  modelVariants,
} from "../dist-electron/main/model-catalog.js";

test("the public model catalogue maps one selectable tier per runtime", () => {
  assert.equal(modelRepository, "https://github.com/OmerDesignX/osCode-Models");
  assert.equal(modelVariants.length, 6);
  for (const runtime of ["llamacpp", "mlx"])
    assert.deepEqual(
      modelVariants
        .filter((variant) => variant.runtime === runtime)
        .map((variant) => variant.tier),
      ["small", "medium", "large"],
    );
});

test("each tier downloads only its own complete shard set", () => {
  for (const variant of modelVariants) {
    const files = filesForVariant(variant);
    assert.equal(
      files.filter((file) =>
        variant.runtime === "llamacpp"
          ? file.endsWith(".gguf")
          : file.endsWith(".safetensors"),
      ).length,
      variant.shards,
    );
    assert.ok(
      files.every((file) =>
        file.startsWith(
          variant.repositoryPath.split("/").slice(0, -1).join("/"),
        ),
      ),
    );
    if (variant.runtime === "mlx") {
      assert.ok(files.includes(`${variant.repositoryPath}/config.json`));
      assert.ok(
        files.includes(
          `${variant.repositoryPath}/model.safetensors.index.json`,
        ),
      );
    }
  }
});
