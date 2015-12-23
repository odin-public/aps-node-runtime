export default {
  isServiceId(string) {
    return /^[a-z]+$/i.test(string); //TODO: Check the actual rules for this
  },

  isResourceId(string) {
    return /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/.test(string);
  }
}
