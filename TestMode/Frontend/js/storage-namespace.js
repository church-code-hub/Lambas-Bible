(function () {
  const prefix = "lambas_test_mode_";

  function createNamespacedStorage(storage) {
    function namespacedKeys() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys;
    }

    return {
      get length() {
        return namespacedKeys().length;
      },
      key(index) {
        return namespacedKeys()[index] || null;
      },
      getItem(key) {
        return storage.getItem(prefix + String(key));
      },
      setItem(key, value) {
        storage.setItem(prefix + String(key), String(value));
      },
      removeItem(key) {
        storage.removeItem(prefix + String(key));
      },
      clear() {
        namespacedKeys().forEach((key) => storage.removeItem(prefix + key));
      },
    };
  }

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createNamespacedStorage(window.localStorage),
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createNamespacedStorage(window.sessionStorage),
    });
    window.LAMBAS_TEST_STORAGE_READY = true;
  } catch (error) {
    window.LAMBAS_TEST_STORAGE_READY = false;
    console.error("Test Mode storage isolation could not be established.", error);
  }
})();
