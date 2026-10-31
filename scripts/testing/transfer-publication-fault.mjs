/** Exercise real transactional rollback at target publication, including ownership release. */
export function withTransferPublicationFault(db, beforeCreate) {
  return new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return (work, options) =>
          target.$transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(client, delegate) {
                    if (delegate !== 'eagleAsset') return Reflect.get(client, delegate);
                    return new Proxy(client.eagleAsset, {
                      get(model, operation) {
                        if (operation === 'create')
                          return async (input) => {
                            await beforeCreate(input);
                            return model.create(input);
                          };
                        const value = Reflect.get(model, operation);
                        return typeof value === 'function' ? value.bind(model) : value;
                      },
                    });
                  },
                }),
              ),
            options,
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
