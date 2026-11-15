import os
import shutil
import argparse
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document

def ingest_papers(papers_dir="papers", db_path="./chroma_db", reset_db=False, collection_name="langchain"):
    """
    Scans `papers_dir` recursively for PDF and TXT files, chunks text into 
    1000-character passages, generates embeddings with all-MiniLM-L6-v2, 
    and stores them in a persistent ChromaDB instance.
    """
    if not os.path.exists(papers_dir):
        print(f"❌ Error: Directory '{papers_dir}' does not exist! Please create it and add your PDFs/TXT files.")
        return

    # Handle database reset if requested (--reset flag)
    if reset_db and os.path.exists(db_path):
        print(f"🧹 Clearing existing ChromaDB database at '{db_path}'...")
        try:
            shutil.rmtree(db_path)
            print("  └─ Existing database cleared.")
        except Exception as e:
            print(f"  ⚠️ Could not remove database folder: {e}")

    # Initialize embedding model & ChromaDB vectorstore matching main.py
    print("🧠 Loading embedding model 'all-MiniLM-L6-v2'...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    vectorstore = Chroma(
        persist_directory=db_path,
        embedding_function=embeddings,
        collection_name=collection_name
    )

    # 1000-character chunks with 150-character overlap for technical documents
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)

    print(f"\n🔍 Searching '{papers_dir}/' and subdirectories for files...")

    total_chunks = 0
    processed_files = 0
    skipped_files = 0

    for root, _, files in os.walk(papers_dir):
        for file in files:
            file_path = os.path.join(root, file)
            filename = os.path.basename(file_path)
            ext = os.path.splitext(file)[1].lower()

            if ext not in ['.pdf', '.txt']:
                continue

            # Automatically skip template / placeholder files
            if filename.startswith("s_") or "sample do not use" in filename.lower():
                print(f"  ⏭️ Skipping placeholder file: {filename}")
                skipped_files += 1
                continue

            processed_files += 1
            print(f"📄 [{processed_files}] Ingesting {filename} ({ext})...")

            try:
                documents = []

                # 1. Process PDF Files
                if ext == '.pdf':
                    loader = PyPDFLoader(file_path)
                    docs = loader.load()
                    split_docs = splitter.split_documents(docs)
                    for doc in split_docs:
                        doc.metadata["source"] = filename
                        doc.metadata["file_path"] = file_path
                        doc.metadata["file_type"] = "pdf"
                        if "page" in doc.metadata:
                            doc.metadata["page"] = doc.metadata["page"] + 1  # 1-indexed page
                        documents.append(doc)

                # 2. Process Text Files
                elif ext == '.txt':
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        text_content = f.read()

                    if "Do not use this" in text_content and len(text_content.strip()) < 200:
                        print(f"  ⏭️ Skipping placeholder text file: {filename}")
                        skipped_files += 1
                        continue

                    if not text_content.strip():
                        print(f"  ⚠️ Skipping empty file: {filename}")
                        continue

                    split_texts = splitter.split_text(text_content)
                    for text_chunk in split_texts:
                        doc = Document(
                            page_content=text_chunk,
                            metadata={
                                "source": filename,
                                "file_path": file_path,
                                "page": 1,
                                "file_type": "txt"
                            }
                        )
                        documents.append(doc)

                if not documents:
                    print(f"  ⚠️ No valid text chunks extracted from {filename}.")
                    continue

                # Batch insert into ChromaDB
                vectorstore.add_documents(documents)
                total_chunks += len(documents)
                print(f"  └─ Added {len(documents)} text chunks to database.")

            except Exception as e:
                print(f"  ❌ Error processing {filename}: {e}")

    print("\n" + "="*50)
    print("✅ INGESTION COMPLETE")
    print(f"📊 Files processed: {processed_files}")
    print(f"⏭️ Files skipped (placeholders/other): {skipped_files}")
    print(f"🧩 Total chunks stored in ChromaDB: {total_chunks}")
    print(f"💾 Vector Database Path: {os.path.abspath(db_path)}")
    print("="*50 + "\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest NASA PDF & TXT research papers into ChromaDB.")
    parser.add_argument("--papers", type=str, default="papers", help="Path to papers folder (default: papers)")
    parser.add_argument("--db", type=str, default="./chroma_db", help="Path to ChromaDB directory (default: ./chroma_db)")
    parser.add_argument("--reset", action="store_true", help="Clear existing vector database before ingesting")

    args = parser.parse_args()
    ingest_papers(papers_dir=args.papers, db_path=args.db, reset_db=args.reset)