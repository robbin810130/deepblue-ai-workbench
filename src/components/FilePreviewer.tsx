import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

interface FilePreviewerProps {
    fileUrl: string;
    fileType?: string;
    fileName?: string;
    className?: string;
    scale?: number;
    renderPDF?: () => React.ReactNode;
}

export const FilePreviewer: React.FC<FilePreviewerProps> = ({ fileUrl, fileType, fileName = '', className = '', scale = 1.0, renderPDF }) => {
    const [content, setContent] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [actualType, setActualType] = useState<string>('');

    // Determine exact file type
    useEffect(() => {
        let type = 'unknown';
        const nameToMatch = (fileName || fileUrl).toLowerCase();
        
        if (fileType === 'image' || /\.(jpe?g|png|gif|bmp|webp|svg)(?:\?.*)?$/i.test(nameToMatch) || fileUrl.startsWith('data:image')) {
            type = 'image';
        } else if (/\.pdf(?:\?.*)?$/i.test(nameToMatch) || fileUrl.startsWith('data:application/pdf')) {
            type = 'pdf';
        } else if (/\.(txt|md|mdx|markdown|html|xml)(?:\?.*)?$/i.test(nameToMatch)) {
            type = 'txt';
        } else if (/\.(doc|docx)(?:\?.*)?$/i.test(nameToMatch)) {
            type = 'word';
        } else if (/\.(xls|xlsx|csv)(?:\?.*)?$/i.test(nameToMatch)) {
            type = 'excel';
        } else if (/\.(ppt|pptx|eml|msg|epub)(?:\?.*)?$/i.test(nameToMatch)) {
            type = 'unsupported';
        } else {
            // fallback
            type = fileType === 'image' ? 'image' : 'pdf'; // Default fallback
        }
        
        setActualType(type);
    }, [fileName, fileUrl, fileType]);

    useEffect(() => {
        if (!actualType || actualType === 'image' || actualType === 'pdf') {
            setLoading(false);
            return;
        }

        if (actualType === 'unsupported') {
            setLoading(false);
            setError('暂不支持该格式的纯前端预览 (PPT/EML/EPUB等格式)，建议您下载后使用专业软件查看');
            return;
        }

        const fetchAndParse = async () => {
            try {
                setLoading(true);
                setError(null);
                const res = await fetch(fileUrl);
                if (!res.ok) throw new Error('文件加载失败');
                
                if (actualType === 'txt') {
                    const text = await res.text();
                    setContent(text);
                } else if (actualType === 'excel') {
                    const arrayBuffer = await res.arrayBuffer();
                    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const htmlStr = XLSX.utils.sheet_to_html(worksheet);
                    setContent(htmlStr);
                } else if (actualType === 'word') {
                    const arrayBuffer = await res.arrayBuffer();
                    const result = await mammoth.convertToHtml({ arrayBuffer });
                    setContent(result.value);
                }
            } catch (err: any) {
                console.error("Parse error:", err);
                setError('文件解析失败，可能不支持该格式的预览');
            } finally {
                setLoading(false);
            }
        };

        fetchAndParse();
    }, [actualType, fileUrl]);

    if (loading) {
        return (
            <div className={`flex flex-col items-center justify-center p-10 text-slate-400 font-bold gap-2 ${className}`}>
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                解析文件中...
            </div>
        );
    }

    if (error) {
        return <div className={`flex items-center justify-center p-10 text-center text-red-500 font-bold ${className}`}>{error}</div>;
    }

    if (actualType === 'image') {
        const style = scale !== 1.0 ? { width: `${scale * 100}%`, maxWidth: 'none', transformOrigin: 'top left' } : {};
        return <img src={fileUrl} alt="preview" className={className} style={style as React.CSSProperties} />;
    }

    if (actualType === 'pdf' && renderPDF) {
        return <>{renderPDF()}</>;
    }

    // For TXT, render in pre
    if (actualType === 'txt') {
        const style = scale !== 1.0 ? { transform: `scale(${scale})`, transformOrigin: 'top left', minWidth: `${(1/scale)*100}%` } : {};
        return (
            <div className={`overflow-auto bg-white p-4 custom-scrollbar text-xs font-mono whitespace-pre-wrap text-slate-700 ${className}`}>
                <div style={style as React.CSSProperties}>
                    {content}
                </div>
            </div>
        );
    }

    // For Word and Excel, render HTML
    const style = scale !== 1.0 ? { transform: `scale(${scale})`, transformOrigin: 'top left', minWidth: `${(1/scale)*100}%` } : {};
    return (
        <div className={`overflow-auto bg-white p-4 custom-scrollbar ${className}`}>
            <div 
                className="prose prose-sm max-w-none prose-table:border-collapse prose-td:border prose-td:border-slate-300 prose-td:p-2 prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-2"
                style={style as React.CSSProperties}
                dangerouslySetInnerHTML={{ __html: content }} 
            />
        </div>
    );
};
