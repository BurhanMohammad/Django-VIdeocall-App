const app = new Vue({
  el: "#app",
  delimiters: ["${", "}"],
  data: {
    callPlaced: false,
    client: null,
    localStream: null,
    mutedAudio: false,
    mutedVideo: false,
    userOnlineChannel: null,
    onlineUsers: [],
    incomingCall: false,
    incomingCaller: "",
    agoraChannel: null,
  },
  mounted() {
    this.initUserOnlineChannel();
  },

  methods: {
    initUserOnlineChannel() {
      const userOnlineChannel = pusher.subscribe("presence-online-channel");

      // Start Pusher Presence Channel Event Listeners

      userOnlineChannel.bind("pusher:subscription_succeeded", (data) => {
        // From Laravel Echo, wrapper for Pusher Js Client
        let members = Object.keys(data.members).map((k) => data.members[k]);
        this.onlineUsers = members;
      });

      userOnlineChannel.bind("pusher:member_added", (data) => {
        let user = data.info;
        // check user availability
        const joiningUserIndex = this.onlineUsers.findIndex(
          (data) => data.id === user.id
        );
        if (joiningUserIndex < 0) {
          this.onlineUsers.push(user);
        }
      });

      userOnlineChannel.bind("pusher:member_removed", (data) => {
        let user = data.info;
        const leavingUserIndex = this.onlineUsers.findIndex(
          (data) => data.id === user.id
        );
        this.onlineUsers.splice(leavingUserIndex, 1);
      });

      userOnlineChannel.bind("pusher:subscription_error", (err) => {
        console.log("Subscription Error", err);
      });

      userOnlineChannel.bind("an_event", (data) => {
        console.log("a_channel: ", data);
      });

      userOnlineChannel.bind("make-agora-call", (data) => {
        // Listen to incoming call. This can be replaced with a private channel

        if (parseInt(data.userToCall) === parseInt(AUTH_USER_ID)) {
          const callerIndex = this.onlineUsers.findIndex(
            (user) => user.id === data.from
          );
          this.incomingCaller = this.onlineUsers[callerIndex]["name"];
          this.incomingCall = true;

          // the channel that was sent over to the user being called is what
          // the receiver will use to join the call when accepting the call.
          this.agoraChannel = data.channelName;
        }
      });
    },

    getUserOnlineStatus(id) {
      const onlineUserIndex = this.onlineUsers.findIndex(
        (data) => data.id === id
      );
      if (onlineUserIndex < 0) {
        return "Offline";
      }
      return "Online";
    },

    async placeCall(id, calleeName) {
      try {
        // channelName = the caller's and the callee's id. you can use anything. tho.
        const channelName = `${AUTH_USER}_${calleeName}`;
        const tokenRes = await this.generateToken(channelName);

        // // Broadcasts a call event to the callee and also gets back the token
        let placeCallRes = await axios.post(
          "/call-user/",
          {
            user_to_call: id,
            channel_name: channelName,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": CSRF_TOKEN,
            },
          }
        );

        this.initializeAgora(tokenRes.data.appID);
        this.joinRoom(tokenRes.data.token, channelName);
      } catch (error) {
        console.log(error);
      }
    },

    async acceptCall() {
      const tokenRes = await this.generateToken(this.agoraChannel);
      this.initializeAgora(tokenRes.data.appID);

      this.joinRoom(tokenRes.data.token, this.agoraChannel);
      this.incomingCall = false;
      this.callPlaced = true;
    },

    declineCall() {
      // You can send a request to the caller to
      // alert them of rejected call
      this.incomingCall = false;
    },

    generateToken(channelName) {
      return axios.post(
        "/token/",
        {
          channelName,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": CSRF_TOKEN,
          },
        }
      );
    },

    /**
     * Agora Events and Listeners
     */
    initializeAgora(agora_app_id) {
      this.client = AgoraRTC.createClient({ mode: "rtc", codec: "h264" });
      this.client.init(
        agora_app_id,
        () => {
          console.log("AgoraRTC client initialized");
        },
        (err) => {
          console.log("AgoraRTC client init failed", err);
        }
      );
    },

    async joinRoom(token, channel) {
      this.client.join(
        token,
        channel,
        AUTH_USER,
        (uid) => {
          console.log("User " + uid + " join channel successfully");
          this.callPlaced = true;
          this.createLocalStream();
          this.initializedAgoraListeners();
        },
        (err) => {
          console.log("Join channel failed", err);
        }
      );
    },

    initializedAgoraListeners() {
      //   Register event listeners
      this.client.on("stream-published", function (evt) {
        console.log("Publish local stream successfully");
        console.log(evt);
      });

      //subscribe remote stream
      this.client.on("stream-added", ({ stream }) => {
        console.log("New stream added: " + stream.getId());
        this.client.subscribe(stream, function (err) {
          console.log("Subscribe stream failed", err);
        });
      });

      this.client.on("stream-subscribed", (evt) => {
        // Attach remote stream to the remote-video div

        console.log("incoming remote stream event: ", evt);

        evt.stream.play("remote-video");
        this.client.publish(evt.stream);
      });

      this.client.on("stream-removed", ({ stream }) => {
        console.log(String(stream.getId()));
        stream.close();
      });

      this.client.on("peer-online", (evt) => {
        console.log("peer-online", evt.uid);
      });

      this.client.on("peer-leave", (evt) => {
        var uid = evt.uid;
        var reason = evt.reason;
        console.log("remote user left ", uid, "reason: ", reason);
      });

      this.client.on("stream-unpublished", (evt) => {
        console.log(evt);
      });
    },

    createLocalStream() {
      this.localStream = AgoraRTC.createStream({
        audio: true,
        video: true,
      });

      // Initialize the local stream
      this.localStream.init(
        () => {
          // Play the local stream
          this.localStream.play("local-video");
          // Publish the local stream
          this.client.publish(this.localStream, (err) => {
            console.log("publish local stream", err);
          });
        },
        (err) => {
          console.log(err);
        }
      );
    },

    endCall() {
      this.localStream.close();
      this.client.leave(
        () => {
          console.log("Leave channel successfully");
          this.callPlaced = false;
        },
        (err) => {
          console.log("Leave channel failed");
        }
      );
      window.pusher.unsubscribe();
    },

    handleAudioToggle() {
      if (this.mutedAudio) {
        this.localStream.unmuteAudio();
        this.mutedAudio = false;
      } else {
        this.localStream.muteAudio();
        this.mutedAudio = true;
      }
    },

    handleVideoToggle() {
      if (this.mutedVideo) {
        this.localStream.unmuteVideo();
        this.mutedVideo = false;
      } else {
        this.localStream.muteVideo();
        this.mutedVideo = true;
      }
    },
  },
});
