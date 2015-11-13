export default {
  isServiceId(string) {
    return /^[a-z]+$/i.test(string); //TODO: Check the actual rules for this
  }
}
