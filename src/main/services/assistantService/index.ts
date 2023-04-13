import GoogleAssistantApiDelegate from 'google-assistant';
import { MainIpcBroker } from 'main/ipc/main/mainIpcBroker';
import AssistantServiceEventHandlers from './assistantServiceEventHandler';
import { AssistantServiceConfig, AssistantConversation } from './types';

// This will load the actual module without any caveats
const GoogleAssistant: typeof GoogleAssistantApiDelegate = require('google-assistant');

/**
 * Service for interfacing with Google Assistant SDK
 */
export class AssistantService {
  /**
   * Configuration for initializing and configuring assistant service.
   */
  config: AssistantServiceConfig;

  /**
   * Instance of Google Assistant class which will interact with the API
   */
  assistantApiDelegate?: GoogleAssistantApiDelegate;

  /**
   * Reference to the active assistant conversation object
   */
  conversation?: AssistantConversation;

  /**
   * Event handlers for assistant service
   */
  handlers: AssistantServiceEventHandlers;

  constructor() {
    this.config = {
      auth: {
        keyFilePath: global.appConfig.keyFilePath,
        savedTokensPath: global.appConfig.savedTokensPath,
        tokenInput: AssistantService.tokenInputHandler,
      },
      conversation: {
        audio: {
          encodingIn: 'LINEAR16',
          sampleRateIn: 16000,
          encodingOut: 'MP3',
          sampleRateOut: 24000,
        },
        lang: global.appConfig.language,
        deviceModelId: '',
        deviceId: '',
        textQuery: undefined,
        isNew: global.appConfig.forceNewConversation,
        screen: {
          isOn: true,
        },
      },
    };

    this.handlers = {
      onQuery: () => {},
      onScreenData: () => {},
      onAudioData: () => {},
      onConversationEnded: () => {},
    };
  }

  /**
   * Initializes the assistant service
   */
  initialize(handlers: AssistantServiceEventHandlers) {
    try {
      this.assistantApiDelegate = new GoogleAssistant(this.config.auth);
      this.handlers = handlers;

      this.assistantApiDelegate?.on('ready', () => {});
      this.assistantApiDelegate?.on('started', this.handleConversation.bind(this));
      this.assistantApiDelegate?.on('error', () => {});

      console.log('Assistant Service initialized successfully');

      // When the user invokes the assiatnt
      MainIpcBroker.onRendererEmit('assistant:invoke', (_, { query }) => {
        MainIpcBroker.sendIpcMessageToRenderer('assistant:stopAudioResponsePlayback', undefined);
        this.invokeAssistant(query);
        this.handlers.onQuery(query ?? '');
      });

      // Write audio input buffer to the conversation when the user speaks
      // via the microphone
      MainIpcBroker.onRendererEmit('assistant:micAudioData', (_, { audioBuffer }) => {
        const buffer = Buffer.from(audioBuffer);
        this.conversation?.write(buffer);
      });

      // If the user asks to end the conversation by stopping the mic input
      MainIpcBroker.onRendererEmit('assistant:endConversation', () => {
        this.conversation?.end();
        this.conversation = undefined;
      });
    }
    catch (error) {
      console.error('Assistant initialization failed.', error);
    }
  }

  handleConversation(conversation: AssistantConversation) {
    this.conversation = conversation;

    conversation.on('audio-data', (data) => {
      // Append audio buffer to the audio buffer list

      const audioBuffer = Buffer.from(data);
      this.handlers.onAudioData(audioBuffer);
    });

    conversation.on('transcription', (transcriptionObject) => {
      MainIpcBroker.sendIpcMessageToRenderer('assistant:transcription', transcriptionObject);

      if (transcriptionObject.done) {
        this.handlers.onQuery(transcriptionObject.transcription);
      }
    });

    conversation.on('screen-data', (screenData) => {
      MainIpcBroker.sendIpcMessageToRenderer('assistant:screenData', {
        ...screenData,
        data: screenData.data.toString(),
      });

      this.handlers.onScreenData(screenData.data.toString());
    });

    conversation.on('end-of-utterance', () => {
      MainIpcBroker.sendIpcMessageToRenderer('assistant:endOfUtterance', undefined);
    });

    conversation.on('ended', (error, shouldContinueConversation) => {
      if (error) {
        console.error(error);
      }

      MainIpcBroker.sendIpcMessageToRenderer('assistant:conversationEnded', undefined);
      this.handlers.onConversationEnded();

      if (shouldContinueConversation && global.appConfig.enableMicOnImmediateResponse) {
        MainIpcBroker.sendIpcMessageToRenderer('assistant:startMic', undefined);
      }
    });

    conversation.on('error', (error) => {
      console.error(error);
    });
  }

  /**
   * Invoke assistant with a query
   *
   * @param textQuery
   * If this parameter is `undefined`, microphone input will be
   * considered
   */
  invokeAssistant(textQuery?: string) {
    if (this.assistantApiDelegate === undefined) {
      throw Error('Cannot trigger "start" event for assistant as the initialization failed');
    }

    if (textQuery) {
      // Set `textQuery` to the provided value
      this.config.conversation.textQuery = textQuery;
    }
    else {
      // Reset `textQuery` to undefined if previously set to
      // a non-null value. This will force microphone input.
      this.config.conversation.textQuery = undefined;
    }

    this.assistantApiDelegate.start(this.config.conversation);
  }

  static tokenInputHandler(
    oauthValidationCallback: (oauthCode: string) => void,
    authUrl: string,
  ): void {
    MainIpcBroker.sendIpcMessageToRenderer('assistant:showOauthTokenPrompt', { authUrl });

    MainIpcBroker.onRendererEmit('assistant:oauthCode', (_, { oauthCode }) => {
      // Callback to process the OAuth Code
      oauthValidationCallback(oauthCode);
    });
  }
}
