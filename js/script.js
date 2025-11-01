// ステータスメッセージをログパネルに表示する関数
function addStatus(message) {
  const logPanel = document.getElementById("logPanel");
  const logEntry = document.createElement("div");
  logEntry.className = "log-entry status";
  logEntry.textContent = message;
  logPanel.appendChild(logEntry);
  logPanel.scrollTop = logPanel.scrollHeight;
}

// 製品名に応じたボーレート設定
let openFlag = false;

const PRODUCT_CONDITIONS = {
  "17W": { baudRate: 115200, needsReopen: false },
  "16J": { baudRate: 38400, needsReopen: true },
  "15C": { baudRate: 57600, needsReopen: true },
  "16C": { baudRate: 115200, needsReopen: false },
  "16V": { baudRate: 57600, needsReopen: true }
};


      // 制御文字を視覚化するヘルパー関数
      function visualizeControlCharacters(msg) {
        const controlCharacters = [
          "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL",
          "BS",  "HT",  "LF",  "VT",  "NP",  "CR",  "SO",  "SI",
          "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB",
          "CAN", "EM",  "SUB", "ESC", "FS",  "GS",  "RS",  "US"
        ];
        // DEL 文字 (0x7F) も視覚化する場合
        return msg.replace(/[\x00-\x1F\x7F]/g, match => {
          let offset = match.charCodeAt(0);
          if (offset === 0x7f) {
            return "[DEL]";
          }
          if (controlCharacters.length > offset) {
            return "[" + controlCharacters[offset] + "]";
          } else {
            // 通常ここには到達しないはずだが念のため
            return `<0x${offset
              .toString(16)
              .toUpperCase()
              .padStart(2, "0")}>`;
          }
        });
      }

      /**
       * 製品名に応じてCOMポートを開く
       * @param {string} productCondition - 製品名 ('17W', '16J', '15C', '16C', '16V')
       * @returns {Promise<SerialPort>} - 接続されたシリアルポート
       */
      async function connectWithProductCondition(productCondition) {
        try {
          // 製品名の確認
          if (!PRODUCT_CONDITIONS[productCondition]) {
            throw new Error(`無効な製品名: ${productCondition}`);
          }

          const config = PRODUCT_CONDITIONS[productCondition];
          console.log(`製品名${productCondition}で接続開始...`);

          // ポートの選択（フィルターなしですべてのCOMポートを表示）
          const port = await navigator.serial.requestPort();

          // 初期接続（115200bpsで開始）
          console.log("初期接続: 115200bpsでオープンします");
          await port.open({
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            flowControl: "none"
          });

          // 製品名16J, 15C, 16Vの場合は再オープンが必要
          if (config.needsReopen) {
            console.log(
              `製品名${productCondition}のため、${config.baudRate}bpsで再オープンします...`
            );

            // 【16J】または【15C】のUint8Arrayのデータを送信
            // 【16V】の場合は、【15C】と同じデータを送信
            const sendData =
              productCondition === "16J" ?
                  new Uint8Array([
                    0x16, 0x4d, 0x0d, 0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x37, 0x2e, 0x2e
                  ])
                : new Uint8Array([
                    0x16, 0x4d, 0x0d, 0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x38, 0x2e, 0x2e
                  ]);

            const writer = port.writable.getWriter();
            await writer.write(sendData);
            writer.releaseLock();

            // デバイスが切り替わるまで少し待つ
            await new Promise(resolve => setTimeout(resolve, 100));

            // 一度ポートを閉じる
            await port.close();
            console.log("ポートを一旦閉じます");

            // 指定されたボーレートで再オープン
            await port.open({
              baudRate: config.baudRate,
              dataBits: 8,
              stopBits: 1,
              parity: "none",
              flowControl: "none"
            });
            console.log(`${config.baudRate}bpsで再オープンが完了しました`);

            // 再オープン後にsendCommandを呼び出す
            await sendCommand(port, "変更bpsで表示テスト");
          } else {
            console.log(
              `製品名${productCondition}のため、再オープンは不要です`
            );
          }

          console.log(
            `製品名${productCondition}での接続が完了しました (${config.baudRate}bps)`
          );
          return port;
        } catch (error) {
          console.error("接続エラー:", error);
          throw error;
        }
      }


      /**
       * 指定されたシリアルポートへコマンドを送る。
       *
       * @param {SerialPort} port - コマンドを送信するシリアルポート
       * @param {string} command - 送信するコマンド文字列
       **/
      async function sendCommand(port, command) {
        const writer = port.writable.getWriter(); // ポートの書き込み可能ストリームからライターを取得する
        const encoder = new TextEncoder(); // コマンドをバイト列に変換するTextEncoderを作成する

        try {
          // エンコードされたコマンドを記述し、改行とキャリッジリターンを続けて入力してください
          await writer.write(encoder.encode(command + "\r\n"));
          console.log(`Sent: ${command}`); // 送信したコマンドを記録する
        } finally {
          writer.releaseLock(); // ライターロックを解放して他の操作を許可する
        }
      }

      /**
       * データ受信例
       * @param {SerialPort} port - シリアルポート
       * @returns {Promise<string>} - 受信したデータ
       */
      async function readResponse(port) {
        const reader = port.readable.getReader();
        const decoder = new TextDecoder();
        let result = "";

        try {
          const { value, done } = await reader.read();
          if (!done) {
            result = decoder.decode(value);
          }
          return result.trim();
        } finally {
          reader.releaseLock();
        }
      }

      let currentReader = null;

      /**
       * シリアルポートからの連続データ読み取りを開始します。
       * @param {SerialPort} port - データを読み取るシリアルポート
       */
      async function startContinuousReading(port) {
        const textArea = document.getElementById("receivedData");
        keepReading = true;
        isReading = true;

        // モーダル1で箱シリアルを読み取るためのバッファ
        let boxSerialBuffer = "";

        try {
          // ポートが読み取り可能で読み取りを継続する場合、ループして継続的に読み取る
          while (port.readable && keepReading) {
              currentReader = port.readable.getReader();
              try {
                  // データチャンクを読み取る内部ループ
                  while (keepReading) {
                    const { value, done } = await currentReader.read();
                    if (done || !keepReading) {
                      break; // 読み取りが完了した場合、または読み取りを継続しない場合は終了してください
                    }
                    const text = new TextDecoder().decode(value);
                    // ここで制御文字を視覚化
                    const visualized = visualizeControlCharacters(text);
                    textArea.value += visualized; // 受信したテキストをテキストエリアに追加する
      
                    // 最新のデータまで自動スクロール
                    textArea.scrollTop = textArea.scrollHeight;
      
                    // --- ここから モーダル1の追加 ---
                    // モーダル1が開いているか確認
                    const modal1 = document.getElementById('modal1Dialog');
                    if (modal1 && modal1.open) {
                      // 受信した生データ(text)から制御文字や改行などを削除して整形
                      const cleanedText = text.replace(/[\r\n\t\x00-\x1F\x7F]/g, '').trim();
                      if (cleanedText) {
                        boxSerialBuffer += cleanedText; // 受信データをバッファに追加
      
                        // 10桁以上になったら処理を実行
                        if (boxSerialBuffer.length >= 10) {
                          const boxSerial = boxSerialBuffer.slice(0, 10); // 先頭10桁を切り出す
                          boxSerialBuffer = ""; // バッファをクリア
      
                          // モーダル内の要素を取得
                          const boxSerialSpan = document.getElementById('boxSerial');
                          const revinfoSerial = document.getElementById('revinfoSerial').textContent;
                          const matchResultSpan = document.getElementById('serialMatchResult');
      
                          // 箱のシリアル番号を表示
                          if (boxSerialSpan) {
                            boxSerialSpan.textContent = boxSerial;
                          }
      
                          // 一致判定と結果表示
                          if (matchResultSpan && revinfoSerial) {
                            if (revinfoSerial === boxSerial) {
                              matchResultSpan.textContent = '一致';
                              matchResultSpan.style.color = 'green';
                            } else {
                              matchResultSpan.textContent = '不一致';
                              matchResultSpan.style.color = 'red';
                            }
                          }
                        }
                      }
                    }
                    // --- ここまでモーダル1の追加 ---
                  }
              } catch (error) {
                  // 読み取りが意図的に停止された場合はエラーを無視する
                  if (!keepReading) break; // ループを抜ける
                  console.error("Error while reading:", error);
              } finally {
                  // リーダーのロックを必ず解除する
                  if (currentReader) {
                      currentReader.releaseLock();
                      currentReader = null;
                  }
              }
          }
        } catch (error) {
          // 予期せぬエラーをログに出力
          console.error("An unexpected error occurred in startContinuousReading:", error);
        } finally {
              isReading = false; // マークを読み終えたとする
            }
      }


      // UIイベントハンドラー
      let currentPort = null;
      let isReading = false; // 読み取り状態を追跡するフラグ
      let keepReading = true; // 読み取り継続フラグ

      function addLog(message, type = "") {
        const logPanel = document.getElementById("logPanel");
        const logEntry = document.createElement("div");
        logEntry.className = `log-entry ${type}`;
        // 制御文字を視覚化して表示
        logEntry.textContent = visualizeControlCharacters(message);
        logPanel.appendChild(logEntry);
        logPanel.scrollTop = logPanel.scrollHeight;
      }

      // シリアルポート接続ボタンのイベントハンドラー
      document
        .getElementById("connectButton")
        .addEventListener("click", async () => {
          try {
            // ラジオボタンで選択されている値を取得
            const productCondition = document.querySelector('input[name="selectRadio"]:checked').value;
            console.log("選択された製品名:", productCondition);
            currentPort = await connectWithProductCondition(productCondition);

            document.getElementById("connectButton").disabled = true;
            document.getElementById("disconnectButton").disabled = false;
            //document.getElementById('sendButton').disabled = false;
            //document.getElementById("productCondition").disabled = true;

            // 受信データ表示エリアをクリア
            document.getElementById("receivedData").value = "";

            // 継続的な受信を開始
            startContinuousReading(currentPort).catch(error => {
              console.error("継続的な受信エラー:", error);
            });

            addLog("接続成功", "success");
          } catch (error) {
            addLog(`接続エラー: ${error.message}`, "error");
          }
      });

      // シリアルポート切断処理中フラグ
      let isDisconnecting = false;

      // シリアルポート切断ボタンのイベントハンドラー
      document
        .getElementById("disconnectButton")
        .addEventListener("click", async () => {
          if (currentPort && !isDisconnecting) {
            isDisconnecting = true;
            document.getElementById("disconnectButton").disabled = true;

            try {
              // 継続的な読み取りを停止
              keepReading = false;

              // 現在のリーダーを強制解放
              if (currentReader) {
                try {
                  await currentReader.cancel();
                  if (currentReader) {
                    // ← ここで再度nullチェック
                    currentReader.releaseLock();
                    currentReader = null;
                  }
                } catch (cancelError) {
                  console.log("リーダーのキャンセル中:", cancelError);
                }
              }

              // 読み取りが完全に停止するまで待機（最大1秒）
              const maxWaitTime = 1000;
              const startTime = Date.now();

              while (isReading && Date.now() - startTime < maxWaitTime) {
                await new Promise(resolve => setTimeout(resolve, 50));
              }

              // ポートを閉じる前に少し待機
              await new Promise(resolve => setTimeout(resolve, 100));

              if (currentPort) {
                try {
                  await currentPort.close();
                } catch (closeError) {
                  // ポートが既に閉じている場合は無視
                  console.log("ポートクローズ中:", closeError);
                }
                currentPort = null;
              }

              document.getElementById("connectButton").disabled = false;
              //document.getElementById('sendButton').disabled = true;
              document.getElementById("productCondition").disabled = false;

              addLog("切断完了", "success");
            } catch (error) {
              console.error("切断処理中のエラー:", error);
              document.getElementById("disconnectButton").disabled = false;
            } finally {
              isDisconnecting = false;
            }
          }
      });

      // ラジオボタンで選択した製品名を
      // リビジョンインフォ・FW/SN抽出・書込・確認の順に
      // 連続的に実行するautoButtonボタンのイベントハンドラー

      // DOMの読み込みが完了してからスクリプトを実行
      document.addEventListener('DOMContentLoaded', function() {
      // autoButtonボタンの要素を取得
      const autoButton = document.getElementById('autoButton');

      // autoButtonボタンにクリックイベントリスナーを追加
      autoButton.addEventListener('click', function() {
      // 現在選択されているラジオボタンを取得
      // 'input[name="selectRadio"]:checked' は、nameが"selectRadio"で、かつチェックされているinput要素を選択します。
      const selectedRadio = document.querySelector('input[name="selectRadio"]:checked');

      // ラジオボタンが選択されているか確認
        if (selectedRadio) {
            // 選択されたラジオボタンのvalue属性（"17W", "16J", "15C", "16C", "16V"のいずれか）を取得
            const selectedValue = selectedRadio.value;

            // 該当するtaskボタンのIDを生成
            // 例: selectedValueが'17W'の場合、'task17WButton' というIDになります。
            const targetButtonId = `task${selectedValue}Button`;

            // 生成したIDに基づいてtaskボタンの要素を取得
            const targetButton = document.getElementById(targetButtonId);

            // taskボタンが存在するか確認
            if (targetButton) {
                // 取得したtaskボタンのclick()メソッドを呼び出す
                targetButton.click();
            } else {
                console.error(`エラー: IDが"${targetButtonId}"のtaskボタンが見つかりません。`);
                alert('エラー: 該当するtaskボタンが見つかりませんでした。');
            }
        } else {
            // ラジオボタンが何も選択されていない場合
            alert('ラジオボタンが選択されていません。');
        }
      });

    // --- 各taskボタンのクリック時の動作を定義 ---
    // これらの関数が、 `autoButton` が実行されたときに呼び出されます。

    document.getElementById('task17WButton').addEventListener('click', async function() {
        //alert('「taskA」が実行されました！');
        console.log('ログ: task17W処理');
        // ここにtaskAに関する実際の処理を記述します。
        await revinfoClick();
        await new Promise(resolve => setTimeout(resolve, 500));
        extractAndDisplay();
        await new Promise(resolve => setTimeout(resolve, 500));
        document.getElementById("Write17W_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1000));
        document.getElementById("checked17W_Button").click();
        await new Promise(resolve => setTimeout(resolve, 800));
    });

    document.getElementById('task16JButton').addEventListener('click', async function() {
        //alert('「taskB」が実行されました！');
        console.log('ログ: task16J処理');
        // ここにtaskBに関する実際の処理を記述します。
        await revinfoClick();
        await new Promise(resolve => setTimeout(resolve, 500));
        extractAndDisplay();
        await new Promise(resolve => setTimeout(resolve, 500));
        document.getElementById("Write16J_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1200));
        document.getElementById("checked16J_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    document.getElementById('task15CButton').addEventListener('click', async function() {
        //alert('「taskC」が実行されました！');
        console.log('ログ: task15C処理');
        // ここにtaskCに関する実際の処理を記述します。
        await revinfoClick();
        await new Promise(resolve => setTimeout(resolve, 500));
        extractAndDisplay();
        await new Promise(resolve => setTimeout(resolve, 500));
        document.getElementById("Write15C_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1200));
        document.getElementById("checked15C_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    document.getElementById('task16CButton').addEventListener('click', async function() {
        //alert('「taskD」が実行されました！');
        console.log('ログ: task16C処理');
        // ここにtaskDに関する実際の処理を記述します。
        await revinfoClick();
        await new Promise(resolve => setTimeout(resolve, 500));
        extractAndDisplay();
        await new Promise(resolve => setTimeout(resolve, 500));
        document.getElementById("Write16C_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1000));
        document.getElementById("checked16C_Button").click();
        await new Promise(resolve => setTimeout(resolve, 800));
    });

    document.getElementById('task16VButton').addEventListener('click', async function() {
        //alert('「taskE」が実行されました！');
        console.log('ログ: task16V処理');
        // ここにtaskEに関する実際の処理を記述します。
        await revinfoClick();
        await new Promise(resolve => setTimeout(resolve, 500));
        extractAndDisplay();
        await new Promise(resolve => setTimeout(resolve, 500));
        document.getElementById("Write16V_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1200));
        document.getElementById("checked16V_Button").click();
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
});


      // リビジョンインフォ取得
        async function revinfoClick() {
        if (!currentPort || !currentPort.writable) {
         addLog("エラー: ポートが開いていないか書き込み不能です。\n");
         return;
        }
        const writer = currentPort.writable.getWriter();
        const cmdrevinf = new Uint8Array([0x16, 0x4D, 0x0D, 0x52, 0x45, 0x56, 0x49, 0x4E, 0x46, 0x2E]);
        try {
        await writer.write(cmdrevinf);
        addLog("●リビジョンインフォ");
        const receivedData = document.getElementById('receivedData');
          receivedData.value += "●リビジョンインフォ\n" ;
          receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動
        } catch (e) {
        addLog("バイナリ送信エラー: " + e + "\n");
        } finally {
        writer.releaseLock();
        }
      }

      // グローバル変数としてシリアルナンバーを保持
      // currentSerialNumber は revinfoClick -> extractAndDisplay でセットされる
      let currentSerialNumber = "";

      // FW/SN抽出
      function extractAndDisplay() {
          // テキストエリアからデータを取得
          const inputText = document.getElementById('receivedData').value;

          // Software Part NumberとSerial Numberをそれぞれ抽出する正規表現パターン
          const softwarePartPattern = /Software Part Number: ([A-Z0-9]{11})/g;
          const serialNumberPattern = /Serial Number: ([A-Z0-9]{10})/g;

          // 結果としてHTMLに表示する内容を保持する変数
          let resultHTML = '';

          let match;
          // Software Part Numberのパターンにマッチする文字列を抽出して結果HTMLに追加
          while ((match = softwarePartPattern.exec(inputText)) !== null) {
              resultHTML += `\n●FWリビジョン:${match[1]} \n`;
              addLog(resultHTML);
          }

          // Serial Numberのパターンにマッチする文字列を抽出して結果HTMLに追加
          while ((match = serialNumberPattern.exec(inputText)) !== null) {
              resultHTML += `●シリアルナンバー：${match[1]}`;
              addLog(resultHTML);
              // ここでダイアログの※1部分に表示
              document.getElementById('revinfoSerial').textContent = match[1];
              // 必要ならグローバル変数にも保持
              currentSerialNumber = match[1];
            }

          // 結果を表示
          // document.getElementById('result').innerHTML = resultHTML;
          // <textarea> にも同じデータを表示
          const receiveArea = document.getElementById('receivedData');
          receiveArea.value += ""+ resultHTML + "\n" ;
          receiveArea.scrollTop = receiveArea.scrollHeight; // スクロールを最下部に移動
      }


      // 17W 設定書込みボタンのイベントリスナー
      document
        .getElementById("Write17W_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
            return;
          }
          const writer = currentPort.writable.getWriter();
          const dataWrite17W_Button = new Uint8Array([0x16, 0x4D, 0xD,
           0x44, 0x45, 0x46, 0x41, 0x4C, 0x54, 0x3B,
           0x50, 0x41, 0x50, 0x32, 0x33, 0x32, 0x3B,
           0x32, 0x33, 0x32, 0x43, 0x54, 0x53, 0x32, 0x3B,
           0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x33, 0x30, 0x30, 0x30, 0x30, 0x3B,
           0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x39, 0x39, 0x30, 0x33, 0x3B,
           0x50, 0x52, 0x45, 0x42, 0x4B, 0x32, 0x39, 0x39, 0x30, 0x32, 0x3B,
           0x41, 0x4C, 0x4C, 0x45, 0x4E, 0x41, 0x30, 0x3B,
           0x51, 0x52, 0x43, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x50, 0x44, 0x46, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x4D, 0x41, 0x58, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x31, 0x3B,
           0x43, 0x33, 0x39, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x31, 0x32, 0x38, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x49, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x43, 0x42, 0x52, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x47, 0x53, 0x31, 0x45, 0x4E, 0x41, 0x31, 0x3B,
           0x53, 0x48, 0x57, 0x4E, 0x52, 0x44, 0x31, 0x2E]);
        try {
          await writer.write(dataWrite17W_Button);
          addLog("●17W設定書き込み\n");
          receivedData.value += "●17W設定書き込み開始\n" ;
        } catch (e) {
          addLog("バイナリ送信エラー: " + e + "\n");
        } finally {
          await new Promise(resolve => setTimeout(resolve, 500));
          const receivedData = document.getElementById('receivedData');
          receivedData.value += "\n●17W設定書き込み完了\n" ; 
          receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動  
          writer.releaseLock();
        }
      });


      // 17W 設定読み込み
      document
        .getElementById("checked17W_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addStatus("エラー: ポートが開いていないか書き込み不能です。\n");
          return;
        }
        const writer = currentPort.writable.getWriter();
        const datachecked17W_Button = new Uint8Array([0x16, 0x4D, 0x0D,
          0x32, 0x33, 0x32, 0x43, 0x54, 0x53, 0x3F, 0x3B,
          0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x3F, 0x3B,
          0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x3F, 0x3B,
          0x50, 0x52, 0x45, 0x42, 0x4B, 0x32, 0x3F, 0x3B,
          0x41, 0x4C, 0x4C, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x51, 0x52, 0x43, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x50, 0x44, 0x46, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x4D, 0x41, 0x58, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x3F, 0x3B,
          0x43, 0x33, 0x39, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x31, 0x32, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x49, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x43, 0x42, 0x52, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x47, 0x53, 0x31, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
          0x53, 0x48, 0x57, 0x4E, 0x52, 0x44, 0x3F, 0x2E]);
        try {
          await writer.write(datachecked17W_Button);
          addStatus("\n" + "●17W設定確認開始\n");
          receivedData.value += "●17W設定確認開始\n" ;
        } catch (e) {
          addStatus("バイナリ送信エラー: " + e + "\n");
        } finally {
          await new Promise(resolve => setTimeout(resolve, 500));
          const receivedDataElem = document.getElementById('receivedData');
          receivedDataElem.value += "\n●17W設定値読み取り完了\n" ;

        // 比較データ取得
          const logText = receivedDataElem.value;
          const startIdx = logText.lastIndexOf("●17W設定確認開始");
          const endIdx = logText.lastIndexOf("●17W設定値読み取り完了");
          const response = logText.substring(startIdx + "●17W設定確認開始".length, endIdx).trim();

        // 17W正解データ
          const correctValue = 
          "232CTS2[ACK];TRGSTO30000[ACK];SUFBK29903[ACK];PREBK29902[ACK];ALLENA[ACK];QRCENA1[ACK];PDFENA1[ACK];MAXENA1[ACK];E13ENA1[ACK];EA8ENA1[ACK];UPAENA1[ACK];UPBENA1[ACK];UPEEN01[ACK];C39ENA1[ACK];128ENA1[ACK];I25ENA1[ACK];CBRENA1[ACK];GS1ENA1[ACK];SHWNRD1[ACK].";

          if (response === correctValue) {
          receivedDataElem.value += "●17W設定値一致しました\n";
        } else {
          receivedDataElem.value += "●17W設定値が正しくありません\n";
        }
          receivedDataElem.scrollTop = receivedDataElem.scrollHeight; // スクロールを最下部に移動 
          writer.releaseLock();
        }
      });


     // 16J書込ボタンのイベントリスナー
      document
        .getElementById("Write16J_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
            return;
          }
          const writer = currentPort.writable.getWriter();
          const dataWrite16J_Button = new Uint8Array([0x16, 0x4d, 0x0d,
            0x44, 0x45, 0x46, 0x41, 0x4C, 0x54, 0x3B,
            0x50, 0x41, 0x50, 0x32, 0x33, 0x32, 0x3B,
            0x32, 0x33, 0x32, 0x43, 0x54, 0x53, 0x31, 0x3B,
            0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x37, 0x3B,
            0x44, 0x45, 0x43, 0x54, 0x4D, 0x4E, 0x32, 0x35, 0x30, 0x30, 0x3B,
            0x44, 0x45, 0x43, 0x54, 0x4D, 0x58, 0x32, 0x35, 0x30, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x4F, 0x54, 0x4F, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x50, 0x54, 0x4F, 0x30, 0x3B,
            0x44, 0x4C, 0x59, 0x41, 0x44, 0x44, 0x30, 0x3B,
            0x32, 0x33, 0x32, 0x44, 0x4C, 0x4B, 0x30, 0x3B,
            0x32, 0x33, 0x32, 0x44, 0x45, 0x4C, 0x30, 0x3B,
            0x4D, 0x50, 0x44, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x41, 0x5A, 0x54, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x41, 0x5A, 0x54, 0x53, 0x54, 0x50, 0x30, 0x3B,
            0x4B, 0x50, 0x43, 0x52, 0x45, 0x56, 0x30, 0x3B,
            0x42, 0x45, 0x50, 0x42, 0x45, 0x50, 0x31, 0x3B,
            0x42, 0x45, 0x50, 0x4C, 0x56, 0x4C, 0x31, 0x3B,
            0x31, 0x32, 0x38, 0x41, 0x50, 0x50, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x4E, 0x53, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x4E, 0x53, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x4E, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x53, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x4C, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x45, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x44, 0x45, 0x43, 0x4D, 0x49, 0x52, 0x31, 0x3B,
            0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x39, 0x39, 0x30, 0x44, 0x30, 0x39, 0x2E]);
          try {
            await writer.write(dataWrite16J_Button);
            //await new Promise(resolve => setTimeout(resolve, 400));
            addLog("●16J設定書き込み完了");
          } catch (e) {
            addLog("バイナリ送信エラー: " + e, "error");
          } finally {
            await new Promise(resolve => setTimeout(resolve, 800));
            const receivedData = document.getElementById('receivedData');
            receivedData.value += "\n●16J設定書き込み完了\n" ;
            receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動
            writer.releaseLock();
          }
        });

      // 16J 設定確認
      document
        .getElementById("checked16J_Button")
        .addEventListener("click", async () => {
        if (!currentPort || !currentPort.writable) {
        addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
        return;
      }
      const writer = currentPort.writable.getWriter();
      const datachecked16J_Button = new Uint8Array([0x16, 0x4D, 0x0D,
        0x32, 0x33, 0x32, 0x43, 0x54, 0x53, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x54, 0x4D, 0x4E, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x54, 0x4D, 0x58, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x4F, 0x54, 0x4F, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x50, 0x54, 0x4F, 0x3F, 0x3B,
        0x44, 0x4C, 0x59, 0x41, 0x44, 0x44, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x44, 0x4C, 0x4B, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x44, 0x45, 0x4C, 0x3F, 0x3B,
        0x4D, 0x50, 0x44, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x41, 0x5A, 0x54, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x41, 0x5A, 0x54, 0x53, 0x54, 0x50, 0x3F, 0x3B,
        0x4B, 0x50, 0x43, 0x52, 0x45, 0x56, 0x3F, 0x3B,
        0x42, 0x45, 0x50, 0x42, 0x45, 0x50, 0x3F, 0x3B,
        0x42, 0x45, 0x50, 0x4C, 0x56, 0x4C, 0x3F, 0x3B,
        0x31, 0x32, 0x38, 0x41, 0x50, 0x50, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x4E, 0x53, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x4E, 0x53, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x4E, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x53, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x4C, 0x45, 0x4E, 0x41, 0x30, 0x3B,
        0x52, 0x53, 0x45, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x4D, 0x49, 0x52, 0x3F, 0x3B,
        0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x3F, 0x2E]);
      try {
        await writer.write(datachecked16J_Button);
          //await new Promise(resolve => setTimeout(resolve, 400));
          addLog("\n" + "●16J設定確認開始\n");
          receivedData.value += "●16J設定確認開始\n" ;
      } catch (e) {
          addLog("バイナリ送信エラー: " + e, "error");
      } finally {
          await new Promise(resolve => setTimeout(resolve, 500));
          const receivedDataElem = document.getElementById('receivedData');
          receivedDataElem.value += "\n●16J設定値読み取り完了\n";
          
        // 比較データ取得
          const logText = receivedDataElem.value;
          const startIdx = logText.lastIndexOf("●16J設定確認開始");
          const endIdx = logText.lastIndexOf("●16J設定値読み取り完了");
          const response = logText.substring(startIdx + "●16J設定確認開始".length, endIdx).trim();

        // 16J正解データ
          const correctValue = 
          "232CTS1[ACK];232BAD7[ACK];DECTMN2500[ACK];DECTMX2500[ACK];TRGOTO0[ACK];TRGSTO0[ACK];TRGPTO0[ACK];DLYADD0[ACK];232DLK0[ACK];232DEL0[ACK];MPDENA1[ACK];AZTENA0[ACK];AZTSTP0[ACK];KPCREV0[ACK];BEPBEP1[ACK];BEPLVL1[ACK];128APP0[ACK];UPAENA0[ACK];UPBENA0[ACK];UPACKX0[ACK];UPANSX0[ACK];UPAADS0[ACK];UPEEN00[ACK];UPECKX0[ACK];UPENSX0[ACK];UPEADS0[ACK];E13ENA0[ACK];E13CKX0[ACK];E13ADS0[ACK];EA8ENA0[ACK];EA8CKX0[ACK];EA8ADS0[ACK];N25ENA0[ACK];RSSENA0[ACK];RSLENA0[ACK];RSEENA0[ACK];DECMIR1[ACK];SUFBK2990D09[ACK].";

          if (response === correctValue) {
          receivedDataElem.value += "●16J設定値一致しました\n";
        } else {
          receivedDataElem.value += "●16J設定値が正しくありません\n";
        }
          receivedDataElem.scrollTop = receivedDataElem.scrollHeight; // スクロールを最下部に移動 
          writer.releaseLock();
        }
    });


     // 15C書込ボタンのイベントリスナー
      document
        .getElementById("Write15C_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
            return;
          }
          const writer = currentPort.writable.getWriter();
          const dataWrite15C_Button = new Uint8Array([0x16, 0x4d, 0x0d,
            0x44, 0x45, 0x46, 0x41, 0x4C, 0x54, 0x3B,
            0x50, 0x41, 0x50, 0x32, 0x33, 0x32, 0x3B,
            0x42, 0x45, 0x50, 0x4C, 0x56, 0x4C, 0x32, 0x3B,
            0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x38, 0x3B,
            0x44, 0x45, 0x43, 0x54, 0x4D, 0x4E, 0x32, 0x35, 0x30, 0x30, 0x3B,
            0x44, 0x45, 0x43, 0x54, 0x4D, 0x58, 0x32, 0x35, 0x30, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x4F, 0x54, 0x4F, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x50, 0x54, 0x4F, 0x30, 0x3B,
            0x44, 0x4C, 0x59, 0x41, 0x44, 0x44, 0x30, 0x3B,
            0x32, 0x33, 0x32, 0x44, 0x4C, 0x4B, 0x30, 0x3B,
            0x32, 0x33, 0x32, 0x44, 0x45, 0x4C, 0x30, 0x3B,
            0x4D, 0x50, 0x44, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x41, 0x5A, 0x54, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x41, 0x5A, 0x54, 0x53, 0x54, 0x50, 0x30, 0x3B,
            0x4B, 0x50, 0x43, 0x52, 0x45, 0x56, 0x30, 0x3B,
            0x42, 0x45, 0x50, 0x42, 0x45, 0x50, 0x30, 0x3B,
            0x44, 0x45, 0x43, 0x4D, 0x49, 0x52, 0x30, 0x3B,
            0x31, 0x32, 0x38, 0x41, 0x50, 0x50, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x4E, 0x53, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x4E, 0x53, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x4E, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x53, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x4C, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x45, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x39, 0x39, 0x30, 0x44, 0x30, 0x39, 0x2E]);
          try {
            await writer.write(dataWrite15C_Button);
            //await new Promise(resolve => setTimeout(resolve, 400));
            addLog("●15C設定書き込み完了");
          } catch (e) {
            addLog("バイナリ送信エラー: " + e, "error");
          } finally {
            await new Promise(resolve => setTimeout(resolve, 500));
            const receivedData = document.getElementById('receivedData');
            receivedData.value += "\n●15C設定書き込み完了\n" ;
            receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動
            writer.releaseLock();
          }
        });

      // 15C 設定値確認
      document
        .getElementById("checked15C_Button")
        .addEventListener("click", async () => {
        if (!currentPort || !currentPort.writable) {
        addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
        return;
      }
      const writer = currentPort.writable.getWriter();
      const datachecked15C_Button = new Uint8Array([0x16, 0x4D, 0x0D,
        0x42, 0x45, 0x50, 0x4C, 0x56, 0x4C, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x54, 0x4D, 0x4E, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x54, 0x4D, 0x58, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x4F, 0x54, 0x4F, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x50, 0x54, 0x4F, 0x3F, 0x3B,
        0x44, 0x4C, 0x59, 0x41, 0x44, 0x44, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x44, 0x4C, 0x4B, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x44, 0x45, 0x4C, 0x3F, 0x3B,
        0x4D, 0x50, 0x44, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x41, 0x5A, 0x54, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x41, 0x5A, 0x54, 0x53, 0x54, 0x50, 0x3F, 0x3B,
        0x4B, 0x50, 0x43, 0x52, 0x45, 0x56, 0x3F, 0x3B,
        0x42, 0x45, 0x50, 0x42, 0x45, 0x50, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x4D, 0x49, 0x52, 0x3F, 0x3B,
        0x31, 0x32, 0x38, 0x41, 0x50, 0x50, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x4E, 0x53, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x4E, 0x53, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x4E, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x53, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x4C, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x45, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x3F, 0x2E]);
    try {
        await writer.write(datachecked15C_Button);
        //await new Promise(resolve => setTimeout(resolve, 400));
        addLog("\n" + "●15C設定確認開始\n");
          receivedData.value += "●15C設定確認開始\n" ;
      } catch (e) {
          addLog("バイナリ送信エラー: " + e, "error");
      } finally {
          await new Promise(resolve => setTimeout(resolve, 500));
          const receivedDataElem = document.getElementById('receivedData');
          receivedDataElem.value += "\n●15C設定値読み取り完了\n";
          
        // 比較データ取得
          const logText = receivedDataElem.value;
          const startIdx = logText.lastIndexOf("●15C設定確認開始");
          const endIdx = logText.lastIndexOf("●15C設定値読み取り完了");
          const response = logText.substring(startIdx + "●15C設定確認開始".length, endIdx).trim();

        // 15C正解データ
          const correctValue = 
          "BEPLVL2[ACK];232BAD8[ACK];DECTMN2500[ACK];DECTMX2500[ACK];TRGOTO0[ACK];TRGSTO0[ACK];TRGPTO0[ACK];DLYADD0[ACK];232DLK0[ACK];232DEL0[ACK];MPDENA1[ACK];AZTENA0[ACK];AZTSTP0[ACK];KPCREV0[ACK];BEPBEP0[ACK];DECMIR0[ACK];128APP0[ACK];UPAENA0[ACK];UPBENA0[ACK];UPACKX0[ACK];UPANSX0[ACK];UPAADS0[ACK];UPEEN00[ACK];UPECKX0[ACK];UPENSX0[ACK];UPEADS0[ACK];E13ENA0[ACK];E13CKX0[ACK];E13ADS0[ACK];EA8ENA0[ACK];EA8CKX0[ACK];EA8ADS0[ACK];N25ENA0[ACK];RSSENA0[ACK];RSLENA0[ACK];RSEENA0[ACK];SUFBK2990D09[ACK].";
          if (response === correctValue) {
          receivedDataElem.value += "●15C設定値一致しました\n";
        } else {
          receivedDataElem.value += "●15C設定値が正しくありません\n";
        }
          receivedDataElem.scrollTop = receivedDataElem.scrollHeight; // スクロールを最下部に移動 
          writer.releaseLock();
    }
  });


      // 16C 設定書込みボタンのイベントリスナー
      document
        .getElementById("Write16C_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
            return;
          }
          const writer = currentPort.writable.getWriter();
          const dataWrite16C_Button = new Uint8Array([0x16, 0x4D, 0xD,
            0x44, 0x45, 0x46, 0x41, 0x4C, 0x54, 0x3B,
            0x50, 0x41, 0x50, 0x32, 0x33, 0x32, 0x3B,
            0x32, 0x33, 0x32, 0x43, 0x54, 0x53, 0x32, 0x3B,
            0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x33, 0x30, 0x30, 0x30, 0x30, 0x3B,
            0x56, 0x53, 0x55, 0x46, 0x43, 0x52, 0x3B,
            0x50, 0x52, 0x45, 0x42, 0x4B, 0x32, 0x39, 0x39, 0x30, 0x32, 0x3B,
            0x41, 0x4C, 0x4C, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x51, 0x52, 0x43, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x50, 0x44, 0x46, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x4D, 0x41, 0x58, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x31, 0x3B,
            0x43, 0x33, 0x39, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x31, 0x32, 0x38, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x49, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x43, 0x42, 0x52, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x47, 0x53, 0x31, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x53, 0x48, 0x57, 0x4E, 0x52, 0x44, 0x31, 0x2E]);
          try {
            await writer.write(dataWrite16C_Button);
            addLog("●16C設定書き込み\n");
          } catch (e) {
            addLog("バイナリ送信エラー: " + e + "\n");
          } finally {
            await new Promise(resolve => setTimeout(resolve, 500));
            const receivedData = document.getElementById('receivedData');
            receivedData.value += "\n●16C設定書き込み完了\n" ;
            receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動  
            writer.releaseLock();
          }
        });


      // 16C 設定値読み込み
      document
        .getElementById("checked16C_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addStatus("エラー: ポートが開いていないか書き込み不能です。\n");
          return;
        }
        const writer = currentPort.writable.getWriter();
        const datachecked16C_Button = new Uint8Array([0x16, 0x4D, 0x0D,
        0x32, 0x33, 0x32, 0x43, 0x54, 0x53, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x3F, 0x3B,
        0x50, 0x52, 0x45, 0x42, 0x4B, 0x32, 0x3F, 0x3B,
        0x41, 0x4C, 0x4C, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x51, 0x52, 0x43, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x50, 0x44, 0x46, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x4D, 0x41, 0x58, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x3F, 0x3B,
        0x43, 0x33, 0x39, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x31, 0x32, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x49, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x43, 0x42, 0x52, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x47, 0x53, 0x31, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x53, 0x48, 0x57, 0x4E, 0x52, 0x44, 0x3F, 0x2E]);
      try {
        await writer.write(datachecked16C_Button);
        addLog("\n" + "●16C設定確認開始\n");
        //await new Promise(resolve => setTimeout(resolve, 400));
        receivedData.value += "●16C設定確認開始\n" ;
      } catch (e) {
          addLog("バイナリ送信エラー: " + e, "error");
      } finally {
          await new Promise(resolve => setTimeout(resolve, 500));
          const receivedDataElem = document.getElementById('receivedData');
          receivedDataElem.value += "\n●16C設定値読み取り完了\n";
          
        // 比較データ取得
          const logText = receivedDataElem.value;
          const startIdx = logText.lastIndexOf("●16C設定確認開始");
          const endIdx = logText.lastIndexOf("●16C設定値読み取り完了");
          const response = logText.substring(startIdx + "●16C設定確認開始".length, endIdx).trim();

        // 16C正解データ
          const correctValue = 
          "232CTS2[ACK];TRGSTO30000[ACK];PREBK29902[ACK];ALLENA[ACK];QRCENA1[ACK];PDFENA1[ACK];MAXENA1[ACK];E13ENA1[ACK];EA8ENA1[ACK];UPAENA1[ACK];UPBENA1[ACK];UPEEN01[ACK];C39ENA1[ACK];128ENA1[ACK];I25ENA1[ACK];CBRENA1[ACK];GS1ENA1[ACK];SHWNRD1[ACK].";
          if (response === correctValue) {
          receivedDataElem.value += "●16C設定値一致しました\n";
        } else {
          receivedDataElem.value += "●16C設定値が正しくありません\n";
        }
          receivedDataElem.scrollTop = receivedDataElem.scrollHeight; // スクロールを最下部に移動 
          writer.releaseLock();
      }
    });


     // 16V書込ボタンのイベントリスナー
      document
        .getElementById("Write16V_Button")
        .addEventListener("click", async () => {
          if (!currentPort || !currentPort.writable) {
            addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
            return;
          }
          const writer = currentPort.writable.getWriter();
          const dataWrite16V_Button = new Uint8Array([0x16, 0x4d, 0x0d,
            0x44, 0x45, 0x46, 0x41, 0x4C, 0x54, 0x3B,
            0x50, 0x41, 0x50, 0x32, 0x33, 0x32, 0x3B,
            0x42, 0x45, 0x50, 0x4C, 0x56, 0x4C, 0x32, 0x3B,
            0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x38, 0x3B,
            0x44, 0x45, 0x43, 0x54, 0x4D, 0x4E, 0x32, 0x35, 0x30, 0x30, 0x3B,
            0x44, 0x45, 0x43, 0x54, 0x4D, 0x58, 0x32, 0x35, 0x30, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x4F, 0x54, 0x4F, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x30, 0x3B,
            0x54, 0x52, 0x47, 0x50, 0x54, 0x4F, 0x30, 0x3B,
            0x44, 0x4C, 0x59, 0x41, 0x44, 0x44, 0x30, 0x3B,
            0x32, 0x33, 0x32, 0x44, 0x4C, 0x4B, 0x30, 0x3B,
            0x32, 0x33, 0x32, 0x44, 0x45, 0x4C, 0x30, 0x3B,
            0x4D, 0x50, 0x44, 0x45, 0x4E, 0x41, 0x31, 0x3B,
            0x41, 0x5A, 0x54, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x41, 0x5A, 0x54, 0x53, 0x54, 0x50, 0x30, 0x3B,
            0x4B, 0x50, 0x43, 0x52, 0x45, 0x56, 0x30, 0x3B,
            0x42, 0x45, 0x50, 0x42, 0x45, 0x50, 0x30, 0x3B,
            0x44, 0x45, 0x43, 0x4D, 0x49, 0x52, 0x31, 0x3B,
            0x31, 0x32, 0x38, 0x41, 0x50, 0x50, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x4E, 0x53, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x41, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x4E, 0x53, 0x58, 0x30, 0x3B,
            0x55, 0x50, 0x45, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x45, 0x31, 0x33, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x43, 0x4B, 0x58, 0x30, 0x3B,
            0x45, 0x41, 0x38, 0x41, 0x44, 0x53, 0x30, 0x3B,
            0x4E, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x53, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x4C, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x52, 0x53, 0x45, 0x45, 0x4E, 0x41, 0x30, 0x3B,
            0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x39, 0x39, 0x30, 0x44, 0x30, 0x39, 0x2E]);
          try {
            await writer.write(dataWrite16V_Button);
            //await new Promise(resolve => setTimeout(resolve, 400));
            addLog("●16V設定書き込み完了");
          } catch (e) {
            addLog("バイナリ送信エラー: " + e, "error");
          } finally {
            await new Promise(resolve => setTimeout(resolve, 500));
            const receivedData = document.getElementById('receivedData');
            receivedData.value += "\n●16V設定書き込み完了\n" ;
            receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動
            writer.releaseLock();
          }
        });

      // 16V 設定値確認
      document
        .getElementById("checked16V_Button")
        .addEventListener("click", async () => {
        if (!currentPort || !currentPort.writable) {
        addLog("エラー: ポートが開いていないか書き込み不能です。", "error");
        return;
      }
      const writer = currentPort.writable.getWriter();
      const datachecked16V_Button = new Uint8Array([0x16, 0x4D, 0x0D,
        0x42, 0x45, 0x50, 0x4C, 0x56, 0x4C, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x42, 0x41, 0x44, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x54, 0x4D, 0x4E, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x54, 0x4D, 0x58, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x4F, 0x54, 0x4F, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x53, 0x54, 0x4F, 0x3F, 0x3B,
        0x54, 0x52, 0x47, 0x50, 0x54, 0x4F, 0x3F, 0x3B,
        0x44, 0x4C, 0x59, 0x41, 0x44, 0x44, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x44, 0x4C, 0x4B, 0x3F, 0x3B,
        0x32, 0x33, 0x32, 0x44, 0x45, 0x4C, 0x3F, 0x3B,
        0x4D, 0x50, 0x44, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x41, 0x5A, 0x54, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x41, 0x5A, 0x54, 0x53, 0x54, 0x50, 0x3F, 0x3B,
        0x4B, 0x50, 0x43, 0x52, 0x45, 0x56, 0x3F, 0x3B,
        0x42, 0x45, 0x50, 0x42, 0x45, 0x50, 0x3F, 0x3B,
        0x44, 0x45, 0x43, 0x4D, 0x49, 0x52, 0x3F, 0x3B,
        0x31, 0x32, 0x38, 0x41, 0x50, 0x50, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x42, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x4E, 0x53, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x41, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x45, 0x4E, 0x30, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x4E, 0x53, 0x58, 0x3F, 0x3B,
        0x55, 0x50, 0x45, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x45, 0x31, 0x33, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x43, 0x4B, 0x58, 0x3F, 0x3B,
        0x45, 0x41, 0x38, 0x41, 0x44, 0x53, 0x3F, 0x3B,
        0x4E, 0x32, 0x35, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x53, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x4C, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x52, 0x53, 0x45, 0x45, 0x4E, 0x41, 0x3F, 0x3B,
        0x53, 0x55, 0x46, 0x42, 0x4B, 0x32, 0x3F, 0x2E]);
    try {
        await writer.write(datachecked16V_Button);
        //await new Promise(resolve => setTimeout(resolve, 400));
        receivedData.value += "●16V設定確認開始\n" ;
      } catch (e) {
          addLog("バイナリ送信エラー: " + e, "error");
      } finally {
          await new Promise(resolve => setTimeout(resolve, 500));
          const receivedDataElem = document.getElementById('receivedData');
          receivedDataElem.value += "\n●16V設定値読み取り完了\n";
          
        // 比較データ取得
          const logText = receivedDataElem.value;
          const startIdx = logText.lastIndexOf("●16V設定確認開始");
          const endIdx = logText.lastIndexOf("●16V設定値読み取り完了");
          const response = logText.substring(startIdx + "●16V設定確認開始".length, endIdx).trim();

        // 16V正解データ
          const correctValue = 
          "BEPLVL2[ACK];232BAD8[ACK];DECTMN2500[ACK];DECTMX2500[ACK];TRGOTO0[ACK];TRGSTO0[ACK];TRGPTO0[ACK];DLYADD0[ACK];232DLK0[ACK];232DEL0[ACK];MPDENA1[ACK];AZTENA0[ACK];AZTSTP0[ACK];KPCREV0[ACK];BEPBEP0[ACK];DECMIR1[ACK];128APP0[ACK];UPAENA0[ACK];UPBENA0[ACK];UPACKX0[ACK];UPANSX0[ACK];UPAADS0[ACK];UPEEN00[ACK];UPECKX0[ACK];UPENSX0[ACK];UPEADS0[ACK];E13ENA0[ACK];E13CKX0[ACK];E13ADS0[ACK];EA8ENA0[ACK];EA8CKX0[ACK];EA8ADS0[ACK];N25ENA0[ACK];RSSENA0[ACK];RSLENA0[ACK];RSEENA0[ACK];SUFBK2990D09[ACK].";
          if (response === correctValue) {
          receivedDataElem.value += "●16V設定値一致しました\n";
        } else {
          receivedDataElem.value += "●16V設定値が正しくありません\n";
        }
          receivedDataElem.scrollTop = receivedDataElem.scrollHeight; // スクロールを最下部に移動 
          writer.releaseLock();
    }
  });


document.querySelectorAll('.modal').forEach(modal => {
  const closeBtn = modal.querySelector('button');
  closeBtn.addEventListener('click', () => {
    modal.removeAttribute('open');
  });
});

const myDialog1 = document.getElementById('modal1Dialog');
const myButton1Open = document.getElementById('button1Open');
const myButton1Close = document.getElementById('button1Close');
myButton1Open.addEventListener('click', () => {
  //myDialog.setAttribute('open', '');
  myDialog1.showModal();
});
myButton1Close.addEventListener('click', () => {
  //myDialog.removeAttribute('open');
  myDialog1.close();
  receivedData.value += "\n●箱シリアル一致\n" ;
  receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動
});

const myDialog2 = document.getElementById('modal2Dialog');
const myButton2Open = document.getElementById('button2Open');
const myButton2Close = document.getElementById('button2Close');
myButton2Open.addEventListener('click', () => {
  //myDialog.setAttribute('open', '');
  myDialog2.showModal();
  // ダイアログを開く時に既存の読み取り状態をクリアして再表示
  const statusDiv = document.getElementById('barcodeStatusInDialog');
  if (statusDiv) {
    statusDiv.innerHTML = ''; // 表示をクリア
    // すでに読み取り済みのバーコードを表示
    scannedBarcodeTypes.forEach(type => {
      updateBarcodeStatusInDialog(type);
    });
  }
});
myButton2Close.addEventListener('click', () => {
  //myDialog.removeAttribute('open');
  myDialog2.close();
  readableBarcode();
  receivedData.scrollTop = receivedData.scrollHeight; // スクロールを最下部に移動
});

const myDialog3 = document.getElementById('modal3Dialog');
const myButton3Open = document.getElementById('button3Open');
const myButton3Close = document.getElementById('button3Close');
const myButton3Back = document.getElementById('button3Back');
myButton3Open.addEventListener('click', () => {
  //myDialog.setAttribute('open', '');
  myDialog3.showModal();
});
myButton3Close.addEventListener('click', () => {
  //myDialog.removeAttribute('open');
  myDialog3.close();
  saveLogs();
  //clearLogs();
});
myButton3Back.addEventListener('click', () => {
  //myDialog.removeAttribute('open');
  myDialog3.close();
});


//箱ラベルのシリアル番号 製品別フォーマット
function extractBoxSerial(rawData, productCondition) {
    // 17W, 16Cは[STX]を除去
    if (productCondition === "17W" || productCondition=== "16C") {
        // [STX]はASCIIコード2
        if (rawData.charCodeAt(0) === 2) {
            return rawData.substr(1, 10);
        } else {
            // 念のため[STX]がなければ先頭10桁
            return rawData.substr(0, 10);
        }
    } else if (productCondition === "15C" || productCondition === "16J" || productCondition === "16V") {
        // そのまま先頭10桁
        return rawData.substr(0, 10);
    } else {
        // その他はデフォルトで先頭10桁
        return rawData.substr(0, 10);
    }
}


// 読み取り許可バーコード検証機能
// 機種ごとの許可バーコードデータを定義
const barcodeDefinitions = {
    // 17W用 (prefix=[STX], suffix=[ETX])
    'UPCA-17W': { prefix: '[STX]', data: '012345678905', suffix: '[ETX]' },
    'QR-17W': { prefix: '[STX]', data: 'QR TEST', suffix: '[ETX]' },
    'PDF417-17W': { prefix: '[STX]', data: 'PDF417 TEST', suffix: '[ETX]' },
    'JANEAN13-17W': { prefix: '[STX]', data: '4901234567894', suffix: '[ETX]' },
    'JANEAN8-17W': { prefix: '[STX]', data: '45123450', suffix: '[ETX]' },
    'MaxiCode-17W': { prefix: '[STX]', data: 'MaxiCode TEST', suffix: '[ETX]' },
    'UPCE-17W': { prefix: '[STX]', data: '01234565', suffix: '[ETX]' },
    'CODE39-17W': { prefix: '[STX]', data: 'CODE39', suffix: '[ETX]' },
    'CODE128-17W': { prefix: '[STX]', data: 'CODE128', suffix: '[ETX]' },
    'ITF2of5-17W': { prefix: '[STX]', data: '012345', suffix: '[ETX]' },
    'Codabar-17W': { prefix: '[STX]', data: '12345', suffix: '[ETX]' },

    // 16J用 (prefix= ,suffix=[CR][HT])
    'QR-16J': { prefix: '', data: 'QR TEST', suffix: '[CR][HT]' },
    'DataMatrix-16J': { prefix: '', data: 'DM TEST', suffix: '[CR][HT]' },
    'PDF417-16J': { prefix: '', data: 'PDF417 TEST', suffix: '[CR][HT]' },
    'MicroPDF-16J': { prefix: '', data: 'MicroPDF TEST', suffix: '[CR][HT]' },

    // 15C用 (prefix= ,suffix=[CR][HT])
    'QR-15C': { prefix: '', data: 'QR_15C', suffix: '[CR][HT]' },
    'DataMatrix-15C': { prefix: '', data: 'DM_15C', suffix: '[CR][HT]' },
    'PDF417-15C': { prefix: '', data: 'PDF417_15C', suffix: '[CR][HT]' },
    'MicroPDF-15C': { prefix: '', data: 'MicroPDF417_15C', suffix: '[CR][HT]' },

    // 16C, 16K, 19F用 (prefix=[STX], suffix=[CR])
    'UPC-A-16C': { prefix: '[STX]', data: '012345678905', suffix: '[CR]' },
    'QR-16C': { prefix: '[STX]', data: 'QR TEST', suffix: '[CR]' },
    'PDF417-16C': { prefix: '[STX]', data: 'PDF417 TEST', suffix: '[CR]' },
    'JAN13/EAN13-16C': { prefix: '[STX]', data: '4901234567894', suffix: '[CR]' },
    'JAN8/EAN8-16C': { prefix: '[STX]', data: '45123450', suffix: '[CR]' },
    'MaxiCode-16C': { prefix: '[STX]', data: 'MaxiCode TEST', suffix: '[CR]' },
    'UPC-E-16C': { prefix: '[STX]', data: '01234565', suffix: '[CR]' },
    'Code39-16C': { prefix: '[STX]', data: 'CODE39', suffix: '[CR]' },
    'Code128-16C': { prefix: '[STX]', data: 'CODE128', suffix: '[CR]' },
    'ITF2of5-16C': { prefix: '[STX]', data: '012345', suffix: '[CR]' },
    'Codabar-16C': { prefix: '[STX]', data: '12345', suffix: '[CR]' },

    // 16V用 (prefix= ,suffix=[CR][HT])
    'QR-16V': { prefix: '', data: 'QR-16V', suffix: '[CR][HT]' },
    'DataMatrix-16V': { prefix: '', data: 'DataMatrix-16V', suffix: '[CR][HT]' },
    'PDF417-16V': { prefix: '', data: 'PDF417-16V', suffix: '[CR][HT]' },
    'MicroPDF-16V': { prefix: '', data: 'MicroPDF-16V', suffix: '[CR][HT]' },
  };

// 読み取り済みのバーコードタイプを追跡するセット
let scannedBarcodeTypes = new Set();

// バーコードの読み取り状態をダイアログに表示する関数
function updateBarcodeStatusInDialog(matchType) {
    const statusDiv = document.getElementById('barcodeStatusInDialog');
    if (statusDiv) {
        const p = document.createElement('p');
        p.textContent = `${matchType}読み取りOK`;
    // インライン色指定をやめてクラスで制御する
    p.classList.add('success');
    statusDiv.appendChild(p);
    }
}

// バーコードデータを検証する関数
function validateBarcodeData() {
    console.log("validateBarcodeData関数が呼び出されました");

    // テキストエリアからデータを取得
    const textarea = document.getElementById('receivedData');
    const textContent = textarea.value;

    console.log("テキストエリアの内容:", textContent);

    // バーコードパターンを検索
    // 最後に出現したバーコードパターンを検索
    const barcodeRegexETX = /\[STX](.*?)\[ETX]/g;
    const barcodeRegexCRHT = /(.*?)\[CR]\[HT]/g;
    const barcodeRegexCR = /\[STX](.*?)\[CR]/g;
    let lastBarcodeMatch = null;
    let match;

    console.log("正規表現パターン:", {
        ETX: barcodeRegexETX.toString(),
        CRHT: barcodeRegexCRHT.toString(),
        CR: barcodeRegexCR.toString()
    });

    // [STX]...[ETX]パターンを検索し、最後のものを保持
    console.log("ETXパターンの検索開始");
    while ((match = barcodeRegexETX.exec(textContent)) !== null) {
        console.log("ETXパターンマッチ:", match);
        lastBarcodeMatch = match;
    }

    // [CR][HT]パターンを検索し、最後のものを保持
    console.log("CRHTパターンの検索開始");
    while ((match = barcodeRegexCRHT.exec(textContent)) !== null) {
        console.log("CRHTパターンマッチ:", match);
        lastBarcodeMatch = match;
    }

    // [STX]...[CR]パターンも検索し、最後のものを保持（より新しい場合）
    console.log("CRパターンの検索開始");
    while ((match = barcodeRegexCR.exec(textContent)) !== null) {
        console.log("CRパターンマッチ:", match);
        lastBarcodeMatch = match;
    }

    // バーコードデータが見つからない場合
    if (!lastBarcodeMatch) {
        textarea.value += "●バーコードデータが見つかりません\n";
        textarea.scrollTop = textarea.scrollHeight;
        return;
    }

    // 見つかったバーコードデータ（[STX]と[ETX]を含む）
    const fullBarcodeData = lastBarcodeMatch[0];
    // データ部分のみ（[STX]と[ETX]を除く）
    const barcodeDataOnly = lastBarcodeMatch[1];

    // デバッグ用：検出されたバーコードデータをログに出力
    console.log("検出されたバーコードデータ:", {
        full: fullBarcodeData,
        dataOnly: barcodeDataOnly,
        match: lastBarcodeMatch
    });

    // バーコードタイプの検証
    let matchFound = false;
    let matchType = '';

    // 17W用のバーコード定義のみを対象とする
    const barcode17WDefinitions = {
        'UPCA-17W': barcodeDefinitions['UPCA-17W'],
        'QR-17W': barcodeDefinitions['QR-17W'],
        'PDF417-17W': barcodeDefinitions['PDF417-17W'],
        'JANEAN13-17W': barcodeDefinitions['JANEAN13-17W'],
        'JANEAN8-17W': barcodeDefinitions['JANEAN8-17W'],
        'MaxiCode-17W': barcodeDefinitions['MaxiCode-17W'],
        'UPCE-17W': barcodeDefinitions['UPCE-17W'],
        'CODE39-17W': barcodeDefinitions['CODE39-17W'],
        'CODE128-17W': barcodeDefinitions['CODE128-17W'],
        'ITF2of5-17W': barcodeDefinitions['ITF2of5-17W'],
        'Codabar-17W': barcodeDefinitions['Codabar-17W'],
      };

    for (const [type, definition] of Object.entries(barcode17WDefinitions)) {
        // 完全一致を確認（制御コードを含む）
        const fullPattern = definition.prefix + definition.data + definition.suffix;
        // デバッグ用：比較結果をログに出力
        console.log(`比較: "${fullBarcodeData}" vs "${fullPattern}" (${type})`);

        if (fullBarcodeData === fullPattern) {
            matchFound = true;
            matchType = type;
            console.log(`一致しました: ${type}`);
            break;
        }
    }

    // 16J用のバーコード定義のみを対象とする
    const barcode16JDefinitions = {
        'QR-16J': barcodeDefinitions['QR-16J'],
        'DataMatrix-16J': barcodeDefinitions['DataMatrix-16J'],
        'PDF417-16J': barcodeDefinitions['PDF417-16J'],
        'MicroPDF-16J': barcodeDefinitions['MicroPDF-16J']
      };

    for (const [type, definition] of Object.entries(barcode16JDefinitions)) {
        // 完全一致を確認（制御コードを含む）
        const fullPattern = definition.prefix + definition.data + definition.suffix;
        // デバッグ用：比較結果をログに出力
        console.log(`比較: "${fullBarcodeData}" vs "${fullPattern}" (${type})`);

        if (fullBarcodeData === fullPattern) {
            matchFound = true;
            matchType = type;
            console.log(`一致しました: ${type}`);
            break;
        }
    }

    // 15C用のバーコード定義のみを対象とする
    const barcode15CDefinitions = {
        'QR-15C': barcodeDefinitions['QR-15C'],
        'DataMatrix-15C': barcodeDefinitions['DataMatrix-15C'],
        'PDF417-15C': barcodeDefinitions['PDF417-15C'],
        'MicroPDF-15C': barcodeDefinitions['MicroPDF-15C']
      };

    for (const [type, definition] of Object.entries(barcode15CDefinitions)) {
        // 完全一致を確認（制御コードを含む）
        const fullPattern = definition.prefix + definition.data + definition.suffix;
        // デバッグ用：比較結果をログに出力
        console.log(`比較: "${fullBarcodeData}" vs "${fullPattern}" (${type})`);

        if (fullBarcodeData === fullPattern) {
            matchFound = true;
            matchType = type;
            console.log(`一致しました: ${type}`);
            break;
        }
    }

    // 16C用のバーコード定義のみを対象とする
    const barcode16CDefinitions = {
        'UPC-A-16C': barcodeDefinitions['UPC-A-16C'],
        'QR-16C': barcodeDefinitions['QR-16C'],
        'PDF417-16C': barcodeDefinitions['PDF417-16C'],
        'JAN13/EAN13-16C': barcodeDefinitions['JAN13/EAN13-16C'],
        'JAN8/EAN8-16C': barcodeDefinitions['JAN8/EAN8-16C'],
        'MaxiCode-16C': barcodeDefinitions['MaxiCode-16C'],
        'UPC-E-16C': barcodeDefinitions['UPC-E-16C'],
        'Code39-16C': barcodeDefinitions['Code39-16C'],
        'Code128-16C': barcodeDefinitions['Code128-16C'],
        'ITF2of5-16C': barcodeDefinitions['ITF2of5-16C'],
        'Codabar-16C': barcodeDefinitions['Codabar-16C'],
      };

    for (const [type, definition] of Object.entries(barcode16CDefinitions)) {
        // 完全一致を確認（制御コードを含む）
        const fullPattern = definition.prefix + definition.data + definition.suffix;
        // デバッグ用：比較結果をログに出力
        console.log(`比較: "${fullBarcodeData}" vs "${fullPattern}" (${type})`);

        if (fullBarcodeData === fullPattern) {
            matchFound = true;
            matchType = type;
            console.log(`一致しました: ${type}`);
            break;
        }
    }

    // 16V用のバーコード定義のみを対象とする
    const barcode16VDefinitions = {
        'QR-16V': barcodeDefinitions['QR-16V'],
        'DataMatrix-16V': barcodeDefinitions['DataMatrix-16V'],
        'PDF417-16V': barcodeDefinitions['PDF417-16V'],
        'MicroPDF-16V': barcodeDefinitions['MicroPDF-16V']
      };

    for (const [type, definition] of Object.entries(barcode16VDefinitions)) {
        // 完全一致を確認（制御コードを含む）
        const fullPattern = definition.prefix + definition.data + definition.suffix;

        // デバッグ用：比較結果をログに出力
        console.log(`比較: "${fullBarcodeData}" vs "${fullPattern}" (${type})`);

        if (fullBarcodeData === fullPattern) {
            matchFound = true;
            matchType = type;
            console.log(`一致しました: ${type}`);
            break;
        }
    }


    // 結果をテキストエリアに追加
    if (matchFound) {
        textarea.value += `\n●${matchType}読み取りOK\n`;
        // 読み取り成功したバーコードタイプをセットに追加
        scannedBarcodeTypes.add(matchType);
        // ダイアログ内の表示を更新
        updateBarcodeStatusInDialog(matchType);
    } else {
        // 部分一致を試みる（16J用のみ）
        let partialMatchType = '';
        for (const [type, definition] of Object.entries(barcode16JDefinitions)) {
            // データ部分のみで一致を確認
            if (barcodeDataOnly === definition.data) {
                partialMatchType = type;
                break;
            }
        }

        // シリアル番号パターン（10桁の英数字）をチェック
        const serialNumberMatch = barcodeDataOnly.match(/^[A-Z0-9]{10}$/);

        // シリアル番号パターンに一致する場合は、メッセージを表示しない
        if (serialNumberMatch) {
            // 箱ラベルのシリアル番号と思われるので、メッセージを表示しない
            return;
        }

        if (partialMatchType) {
            textarea.value += `●${partialMatchType}読み取りNG\n`;
        } else {
            textarea.value += `●バーコード読み取りNG\n`;
        }
    }

    textarea.scrollTop = textarea.scrollHeight;
}

// バーコードデータの自動検証機能を追加
// DOMContentLoaded イベントで実行して、スクリプトの読み込み順序の問題を回避
document.addEventListener('DOMContentLoaded', function() {
    // バーコードデータの検出と検証を行う関数
    function checkForBarcodeData(newContent, oldContent) {
        // 新しく追加されたテキストを取得（差分を検出）
        const newText = newContent.substring(oldContent.length);

        // リビジョンインフォの応答（[ACK]を含む）の場合はスキップ
        if (newText.includes('[ACK]')) {
            return;
        }

        // 新しいテキストに[ETX]または[CR]が含まれているかチェック
        if (newText.includes('[ETX]') || newText.includes('[CR][HT]')|| newText.includes('[CR]')) {
            // 自動的にバーコード検証を実行
            setTimeout(validateBarcodeData, 50); // 少し遅延させて実行
        }
    }

    // シリアルデータの受信を監視
    const textarea = document.getElementById('receivedData');
    if (textarea) {
        // テキストエリアの内容を監視
        let lastContent = textarea.value;

        // MutationObserverを使用してテキストエリアの変更を監視
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (textarea.value !== lastContent) {
                    // 内容が変更された場合、バーコードデータをチェック
                    checkForBarcodeData(textarea.value, lastContent);
                    // 最後の内容を更新
                    lastContent = textarea.value;
                }
            });
        });

        // テキストエリアの変更を監視する設定
        observer.observe(textarea, { 
            attributes: true, 
            childList: true, 
            characterData: true,
            subtree: true
        });

        // バックアップとして、定期的にもチェック
        setInterval(function() {
            if (textarea.value !== lastContent) {
                checkForBarcodeData(textarea.value, lastContent);
                lastContent = textarea.value;
            }
        }, 500); // 500ミリ秒ごとにチェック
    } else {
        console.warn("receiveArea not found. Barcode validation may not work properly.");
    }
});

// バーコード検証ボタンのクリックイベントハンドラ
function readableBarcode() {
    console.log("readableBarcode関数が呼び出されました");

    // テキストエリアを取得
    const textarea = document.getElementById('receivedData');

    // 現在選択されている検査モデル名を取得
    const productCondition = document.querySelector('input[name="selectRadio"]:checked').value;

    // 検査モデルに応じたバーコードタイプを取得
    const barcode17WTypes = ['UPCA-17W', 'QR-17W', 'PDF417-17W', 'JANEAN13-17W', 'JANEAN8-17W', 'MaxiCode-17W', 'UPCE-17W', 'CODE39-17W', 'CODE128-17W', 'ITF2of5-17W', 'Codabar-17W'];
    const barcode16JTypes = ['QR-16J', 'DataMatrix-16J', 'PDF417-16J', 'MicroPDF-16J'];
    const barcode15CTypes = ['QR-15C', 'DataMatrix-15C', 'PDF417-15C', 'MicroPDF-15C'];
    const barcode16CTypes = ['UPC-A-16C', 'QR-16C', 'PDF417-16J', 'JAN13/EAN13-16C', 'JAN8/EAN8-16C', 'MaxiCode-16C', 'UPC-E-16C', 'Code39-16C', 'Code128-16C', 'ITF2of5-16C', 'Codabar-16C'];
    const barcode16VTypes = ['QR-16V', 'DataMatrix-16V', 'PDF417-16V', 'MicroPDF-16V'];

    // 読み取り済みのバーコードタイプの数をカウント
    const scanned17WCount = Array.from(scannedBarcodeTypes).filter(type => barcode17WTypes.includes(type)).length;
    const scanned16JCount = Array.from(scannedBarcodeTypes).filter(type => barcode16JTypes.includes(type)).length;
    const scanned15CCount = Array.from(scannedBarcodeTypes).filter(type => barcode15CTypes.includes(type)).length;
    const scanned16CCount = Array.from(scannedBarcodeTypes).filter(type => barcode16CTypes.includes(type)).length;
    const scanned16VCount = Array.from(scannedBarcodeTypes).filter(type => barcode16VTypes.includes(type)).length;

    // 機種ごとの必須バーコードリスト
    const requiredBarcodes = {
        '17W': ['UPCA-17W', 'QR-17W', 'PDF417-17W', 'JANEAN13-17W', 'JANEAN8-17W', 'MaxiCode-17W', 'UPCE-17W', 'CODE39-17W', 'CODE128-17W', 'ITF2of5-17W', 'Codabar-17W'],
        '16J': ['QR-16J', 'DataMatrix-16J', 'PDF417-16J', 'MicroPDF-16J'],
        '15C': ['QR-15C', 'DataMatrix-15C', 'PDF417-15C', 'MicroPDF-15C'],
        '16C': ['UPC-A-16C', 'QR-16C', 'PDF417-16C', 'JAN13/EAN13-16C', 'JAN8/EAN8-16C', 'MaxiCode-16C', 'UPC-E-16C', 'Code39-16C', 'Code128-16C', 'ITF2of5-16C', 'Codabar-16C'],
        '16V': ['QR-16V', 'DataMatrix-16V', 'PDF417-16V', 'MicroPDF-16V'],
    };

    /*// 16J用のバーコードが全て読み取られているかチェック
    if (scanned16JCount >= barcode16JTypes.length) {
        // 全ての16J用バーコードタイプが読み取られている場合
        textarea.value += `●${barcode16JTypes.length}種読み取りOK\n`;
    */

    // 現在の機種の必須バーコードリストを取得
    const currentRequiredTypes = requiredBarcodes[productCondition];

    // 対象機種の定義がなければ処理を終了
    if (!currentRequiredTypes) {
        console.log(`readableBarcode: 機種'${productCondition}'のバーコードチェックは定義されていません。`);
        return;
    }

    // 読み取り済みの必須バーコードの数をカウント
    const scannedRequiredCount = Array.from(scannedBarcodeTypes).filter(type => currentRequiredTypes.includes(type)).length;

    // 必須バーコードが全て読み取られているかチェック
    if (scannedRequiredCount >= currentRequiredTypes.length) {
        // 全ての必須バーコードタイプが読み取られている場合
        textarea.value += `●${currentRequiredTypes.length}種読み取りOK\n`;
    } else {
        // 読み取られていない16J用バーコードタイプを特定
        const missing16JTypes = barcode16JTypes.filter(type => !scannedBarcodeTypes.has(type));

        // 読み取られていない16J用バーコードタイプを表示
        missing16JTypes.forEach(type => {
        // 読み取られていないバーコードタイプを特定して表示
        const missingTypes = currentRequiredTypes.filter(type => !scannedBarcodeTypes.has(type));
        missingTypes.forEach(type => {
            textarea.value += `●${type}を読んでいません\n`;
        });
      }
      );textarea.scrollTop = textarea.scrollHeight;
  }
}

// ボタン押下 download
function saveLogs() {
  const textarea = document.querySelector('#receivedData');
  if (!textarea) {
      console.error("Download error: 'receivedData' not found.");
      alert("エラー: 受信エリアが見つかりません。");
      return;
  }
  const output = textarea.value;
  if (output.trim() !== "") {
      // シリアルナンバーを抽出
      const serialNumberMatch = output.match(/シリアルナンバー：([A-Z0-9]{10})/);

      // ファイル名を設定（シリアルナンバーが見つかればそれを使用、なければデフォルト名）
      let filename = "ReceivedData.txt";
      if (serialNumberMatch && serialNumberMatch[1]) {
          filename = serialNumberMatch[1] + ".txt";
      }

      // 従来の方法（File System Access APIが使えない場合や、エラーが発生した場合のフォールバック）
      downloadFallback(output, filename);
  } else {
      addLog("保存するデータがありません。\n");
  }
}

// 従来のダウンロード方法（フォールバック用）
function downloadFallback(output, filename) {
  const blob = new Blob([output], { type: "text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  addLog(`●ログエリア保存: ${filename}\n`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


      // ログエリアをクリアする関数
      function clearLogs() {
        const textarea = document.getElementById('receivedData');
        if (textarea) {
          textarea.value = '';
          // バーコードスキャン状態もリセット
          //resetScannedBarcodeTypes();
        }
      }

      // console.logをUIに表示するようにオーバーライド
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;

      // Override console.log to display messages in the UI log panel
      console.log = function(...args) {
        // Add log entry to the UI log panel
        addLog(args.join(" "));
        // Call the original console.log to ensure messages still appear in the console
        originalConsoleLog.apply(console, args);
      };

      // Override console.error to display errors in the UI log panel
      console.error = function(...args) {
        // Add log entry to the UI log panel with the 'error' class
        addLog(args.join(" "), "error");
        // Call the original console.error to ensure errors still appear in the console
        originalConsoleError.apply(console, args);
      };