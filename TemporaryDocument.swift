/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Originally derived from brave/brave-core
//   ios/brave-ios/Sources/Brave/Frontend/Browser/TemporaryDocument.swift
// Modified by NAVER Corp. for Whale iOS.

import Foundation
import Combine


class TemporaryDocument: NSObject {
    
    static let defaultOperationQueue: OperationQueue = .init()
    
    let subject: PassthroughSubject<URL, Error> = .init()

    init(preflightResponse: URLResponse,
         downloadTask: HTTPDownloadTask,
         operationQueue: OperationQueue = TemporaryDocument.defaultOperationQueue) {
        self.downloadTask = downloadTask
        self.filename = preflightResponse.downloadFileName
        super.init()
        
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: operationQueue)
        self.session = session
        downloadTask.set(session: session)
    }

    deinit {
        self.subject.send(completion: .finished)
        if let url = self.localFileURL {
            try? FileManager.default.removeItem(at: url)
        } else {
            self.downloadTask.cancel()
        }
    }
    
    private let filename: String

    private var session: URLSession?

    private let downloadTask: HTTPDownloadTask
    private var localFileURL: URL?
}


extension TemporaryDocument: URLSessionTaskDelegate, URLSessionDownloadDelegate {
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // If we encounter an error downloading the temp file, just return with the
        // original remote URL so it can still be shared as a web URL.
        if error != nil {
            self.subject.send(self.downloadTask.url)
            self.subject.send(completion: .finished)
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let tempDirectory: URL = .init(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("TempDocs")
        let url: URL = tempDirectory.appendingPathComponent(self.filename)

        try? FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true, attributes: nil)
        try? FileManager.default.removeItem(at: url)

        do {
            try FileManager.default.moveItem(at: location, to: url)
            self.subject.send(url)
            self.localFileURL = url
            self.subject.send(completion: .finished)
        } catch {
            // If we encounter an error downloading the temp file, just return with the
            // original remote URL so it can still be shared as a web URL.
            self.subject.send(self.downloadTask.url)
            self.subject.send(completion: .finished)
        }
    }

}
