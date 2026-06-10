Page({
  data: {
    loading: false,
    name: "",
    status: "Idle"
  },

  onSubmit() {
    console.info("submit clicked");
    this.setData({
      loading: true,
      status: "Request in progress"
    });
  },

  onNameInput(event) {
    this.setData({
      name: event.detail.value
    });
  }
});
