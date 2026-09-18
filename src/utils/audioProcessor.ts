import * as lamejs from 'lamejs';

export interface CompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
}

export type ProgressCallback = (progress: number) => void;

/**
 * 浏览器端音频压制工具
 */
export class AudioProcessor {
  /**
   * 压制音频文件至 MP3 格式
   * @param file 原始音频文件
   * @param onProgress 进度回调 (0-100)
   */
  static async compressAudio(
    file: File,
    onProgress?: ProgressCallback
  ): Promise<CompressionResult> {
    const originalSize = file.size;

    // 如果文件本身已经很小 (< 10MB)，且已经是 mp3，可以考虑跳过压缩
    // 但用户要求“先压缩”，所以我们还是执行一次标准的重采样压制
    
    // 1. 解码音频文件
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 2. 设置重采样参数 (AI 识别建议：16kHz, 单声道)
    const targetSampleRate = 16000;
    const targetChannels = 1;
    
    // 使用 OfflineAudioContext 进行重采样
    const offlineContext = new OfflineAudioContext(
      targetChannels,
      Math.ceil(audioBuffer.duration * targetSampleRate),
      targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    const renderedBuffer = await offlineContext.startRendering();
    
    // 3. 使用 lamejs 进行 MP3 编码
    // 注意：lamejs 需要 Int16Array 格式的 PCM 数据
    const pcmData = renderedBuffer.getChannelData(0);
    const int16Pcm = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      // 将 Float32 (-1.0 ~ 1.0) 转换为 Int16 (-32768 ~ 32767)
      const s = Math.max(-1, Math.min(1, pcmData[i]));
      int16Pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const kbps = 32;
    const LameNamespace = (lamejs as any).default || lamejs;
    const EncoderClass = LameNamespace.Mp3Encoder;
    if (!EncoderClass) {
        throw new Error('无法初始化 MP3 编码器 (lamejs Mp3Encoder not found)');
    }
    
    // 补丁：深层次解决 lamejs 内部类（BitStream, MPEGMode, Lame 等）丢失的问题
    
    // 全量补丁策略：将 LameNamespace 下的所有成员全部映射到 window，彻底一劳永逸
    Object.keys(LameNamespace).forEach(key => {
        if (!(window as any)[key]) {
            const member = LameNamespace[key];
            // 对枚举值特殊处理 ordinal
            if (typeof member === 'object' && member !== null) {
                Object.keys(member).forEach(mKey => {
                    const mVal = member[mKey];
                    if (typeof mVal === 'number' && member[mKey] && !member[mKey].ordinal) {
                        try {
                           member[mKey] = { value: mVal, ordinal: function() { return this.value; } };
                        } catch(e) {}
                    }
                });
            }
            (window as any)[key] = member;
        }
    });

    const mp3encoder = new EncoderClass(targetChannels, targetSampleRate, kbps);
    const mp3Data: any[] = [];
    
    const sampleBlockSize = 1152;
    for (let i = 0; i < int16Pcm.length; i += sampleBlockSize) {
      const chunk = int16Pcm.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
      
      if (onProgress) {
        const progress = Math.round((i / int16Pcm.length) * 100);
        onProgress(progress);
      }
    }

    const finishBuf = mp3encoder.flush();
    if (finishBuf.length > 0) {
      mp3Data.push(finishBuf);
    }

    const compressedBlob = new Blob(mp3Data, { type: 'audio/mp3' });
    
    // 安全检查：如果压缩后反而变大了，或者压缩力度极小 (源文件已经是低码率)，则回退到原始文件
    // 但无论如何，我们都要返回统计数据以便 UI 展示
    const isBeneficial = compressedBlob.size < originalSize * 0.98;
    
    if (!isBeneficial) {
      console.log('[AudioProcessor] Compression not beneficial, using original file.');
      return {
        blob: file,
        originalSize,
        compressedSize: originalSize // 这里设为原始大小，UI 会显示“已跳过”
      };
    }

    return {
      blob: compressedBlob,
      originalSize,
      compressedSize: compressedBlob.size
    };
  }

  /**
   * 格式化文件大小
   */
  static formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
