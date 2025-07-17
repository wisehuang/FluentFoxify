// Cross-browser compatibility
const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

// Enhanced storage functions with Firefox compatibility and fallbacks
function getStorage(key) {
  return new Promise((resolve) => {
    // Try sync storage first
    try {
      if (browserAPI.storage && browserAPI.storage.sync) {
        browserAPI.storage.sync.get(key).then((data) => {
          console.log('Retrieved from sync storage:', data);
          resolve(data);
        }).catch((error) => {
          console.warn('Sync storage get failed, trying local storage:', error);
          // Fallback to local storage
          browserAPI.storage.local.get(key).then((data) => {
            console.log('Retrieved from local storage:', data);
            resolve(data);
          }).catch((localError) => {
            console.error('Local storage get failed:', localError);
            resolve({});
          });
        });
      } else {
        // Fallback to callback-based API
        browserAPI.storage.sync.get(key, (data) => {
          if (browserAPI.runtime.lastError) {
            console.warn('Sync storage callback failed, trying local:', browserAPI.runtime.lastError);
            browserAPI.storage.local.get(key, (localData) => {
              console.log('Retrieved from local storage (callback):', localData);
              resolve(localData || {});
            });
          } else {
            console.log('Retrieved from sync storage (callback):', data);
            resolve(data || {});
          }
        });
      }
    } catch (error) {
      console.error('Storage get error:', error);
      resolve({});
    }
  });
}

function setStorage(data) {
  return new Promise((resolve) => {
    console.log('Attempting to save to storage:', data);
    
    // Try sync storage first
    try {
      if (browserAPI.storage && browserAPI.storage.sync && browserAPI.storage.sync.set) {
        browserAPI.storage.sync.set(data).then(() => {
          console.log('Saved to sync storage successfully');
          resolve();
        }).catch((error) => {
          console.warn('Sync storage set failed, trying local storage:', error);
          // Fallback to local storage
          browserAPI.storage.local.set(data).then(() => {
            console.log('Saved to local storage successfully');
            resolve();
          }).catch((localError) => {
            console.error('Local storage set failed:', localError);
            resolve();
          });
        });
      } else {
        // Fallback to callback-based API
        browserAPI.storage.sync.set(data, () => {
          if (browserAPI.runtime.lastError) {
            console.warn('Sync storage callback failed, trying local:', browserAPI.runtime.lastError);
            browserAPI.storage.local.set(data, () => {
              if (browserAPI.runtime.lastError) {
                console.error('Local storage callback failed:', browserAPI.runtime.lastError);
              } else {
                console.log('Saved to local storage (callback) successfully');
              }
              resolve();
            });
          } else {
            console.log('Saved to sync storage (callback) successfully');
            resolve();
          }
        });
      }
    } catch (error) {
      console.error('Storage set error:', error);
      resolve();
    }
  });
}

document.addEventListener('DOMContentLoaded', async function() {
  const apiKeyContainer = document.getElementById('apiKeyContainer');
  const refineContainer = document.getElementById('refineContainer');
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyButton = document.getElementById('saveApiKey');
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const inputText = document.getElementById('inputText');
  const refineButton = document.getElementById('refineButton');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const resultContainer = document.getElementById('resultContainer');
  const result = document.getElementById('result');
  const copyButton = document.getElementById('copyButton');
  const error = document.getElementById('error');
  const showSettings = document.getElementById('showSettings');

  // Check if API key is already set
  console.log('Checking for existing API key...');
  try {
    const data = await getStorage('openaiApiKey');
    console.log('API key check result:', data);
    
    if (data && data.openaiApiKey && data.openaiApiKey.length > 0) {
      console.log('API key found, switching to main interface');
      // API key is set, show enhancement interface
      apiKeyContainer.style.display = 'none';
      refineContainer.style.display = 'block';
    } else {
      console.log('No API key found, showing setup interface');
      // API key is not set, show settings interface (already visible)
      apiKeyContainer.style.display = 'block';
      refineContainer.style.display = 'none';
    }
  } catch (error) {
    console.error('Error checking API key:', error);
    // Default to showing API key container
    apiKeyContainer.style.display = 'block';
    refineContainer.style.display = 'none';
  }

  // Save API key
  saveApiKeyButton.addEventListener('click', async function() {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      apiKeyStatus.textContent = 'Please enter a valid API key';
      apiKeyStatus.style.color = '#d93025';
      return;
    }

    // Validate API key format
    if (!apiKey.startsWith('sk-')) {
      apiKeyStatus.textContent = 'Invalid API key format, should start with sk-';
      apiKeyStatus.style.color = '#d93025';
      return;
    }

    // Save API key
    try {
      await setStorage({ 'openaiApiKey': apiKey });
      
      // Verify the save worked by reading it back
      const verification = await getStorage('openaiApiKey');
      if (verification.openaiApiKey === apiKey) {
        apiKeyStatus.textContent = 'API key saved successfully';
        apiKeyStatus.style.color = '#0f9d58';
        console.log('API key save verified successfully');
        
        // Switch to enhancement interface after delay
        setTimeout(function() {
          apiKeyContainer.style.display = 'none';
          refineContainer.style.display = 'block';
        }, 1000);
      } else {
        console.error('API key save verification failed. Saved:', verification);
        apiKeyStatus.textContent = 'API key save verification failed';
        apiKeyStatus.style.color = '#d93025';
      }
    } catch (error) {
      console.error('Error saving API key:', error);
      apiKeyStatus.textContent = 'Error saving API key';
      apiKeyStatus.style.color = '#d93025';
    }
  });

  // Enhance button click event
  refineButton.addEventListener('click', async function() {
    const text = inputText.value.trim();
    
    if (!text) {
      error.textContent = 'Please enter an English sentence to enhance';
      error.style.display = 'block';
      resultContainer.style.display = 'none';
      return;
    }

    // Show loading indicator
    loadingIndicator.style.display = 'block';
    error.style.display = 'none';
    resultContainer.style.display = 'none';

    try {
      // Get API key from storage
      const data = await getStorage('openaiApiKey');
      if (!data.openaiApiKey) {
        loadingIndicator.style.display = 'none';
        error.textContent = 'API key not set, please configure settings first';
        error.style.display = 'block';
        return;
      }

      // Send message to background.js to process text
      browserAPI.runtime.sendMessage({
        action: "refineText",
        text: text,
        apiKey: data.openaiApiKey
      }, function(response) {
        loadingIndicator.style.display = 'none';
        
        if (response && response.success) {
          result.textContent = response.refinedText;
          resultContainer.style.display = 'block';
        } else {
          // Detailed error handling
          if (response && response.error) {
            error.textContent = `Error: ${response.error}`;
          } else if (browserAPI.runtime.lastError) {
            error.textContent = `Runtime error: ${browserAPI.runtime.lastError.message}`;
          } else {
            error.textContent = 'Unable to connect to API. Check your network connection and API key.';
          }
          error.style.display = 'block';
        }
      });
    } catch (error) {
      console.error('Error during enhancement:', error);
      loadingIndicator.style.display = 'none';
      error.textContent = 'An error occurred while processing your request';
      error.style.display = 'block';
    }
  });

  // Copy to clipboard
  copyButton.addEventListener('click', function() {
    const textToCopy = result.textContent;
    navigator.clipboard.writeText(textToCopy).then(function() {
      copyButton.textContent = 'Copied!';
      setTimeout(function() {
        copyButton.textContent = 'Copy to Clipboard';
      }, 2000);
    }).catch(function() {
      error.textContent = 'Failed to copy text to clipboard';
      error.style.display = 'block';
    });
  });

  // Show settings link click event
  showSettings.addEventListener('click', async function(e) {
    e.preventDefault();
    refineContainer.style.display = 'none';
    apiKeyContainer.style.display = 'block';
    
    try {
      // Load saved API key
      const data = await getStorage('openaiApiKey');
      if (data.openaiApiKey) {
        apiKeyInput.value = data.openaiApiKey;
      }
    } catch (error) {
      console.error('Error loading API key for settings:', error);
    }
  });
});